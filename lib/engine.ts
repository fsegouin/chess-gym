import { ELO_MAX, ELO_MIN } from "./settings";

/** Score from the point of view of the side to move. */
export type Score = { cp: number } | { mate: number };

export interface Analysis {
  /** UCI move such as "e2e4" or "e7e8q"; null when the side to move has no legal move. */
  bestMove: string | null;
  score: Score;
  pv: string[];
  depth: number;
}

type EngineOption = string | number | boolean;

const ENGINE_URL = "/engine/stockfish.js";

/**
 * Thin UCI client around Stockfish running in a Web Worker.
 * Searches are serialized: a new one starts only after the previous one reports bestmove.
 */
export class Engine {
  private worker: Worker;
  private lineListeners = new Set<(line: string) => void>();
  private errorListeners = new Set<(error: Error) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private failed: Error | null = null;
  /** Bumped by stop(); searches queued before a stop are skipped instead of run. */
  private stopEpoch = 0;

  constructor(url = ENGINE_URL) {
    this.worker = new Worker(url);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data);
      this.lineListeners.forEach((l) => l(line));
    };
    this.worker.onerror = (e: ErrorEvent) => {
      const error = new Error(e.message || "The chess engine failed to load");
      this.failed = error;
      this.errorListeners.forEach((l) => l(error));
    };
    this.ready = this.handshake();
    // Avoid an unhandled rejection if nobody awaits the engine before it fails.
    this.ready.catch(() => {});
  }

  private send(command: string): void {
    this.worker.postMessage(command);
  }

  private waitFor(match: (line: string) => boolean, onLine?: (line: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.failed) return reject(this.failed);
      const cleanup = () => {
        this.lineListeners.delete(lineListener);
        this.errorListeners.delete(errorListener);
      };
      const lineListener = (line: string) => {
        onLine?.(line);
        if (match(line)) {
          cleanup();
          resolve(line);
        }
      };
      const errorListener = (error: Error) => {
        cleanup();
        reject(error);
      };
      this.lineListeners.add(lineListener);
      this.errorListeners.add(errorListener);
    });
  }

  private async handshake(): Promise<void> {
    const uciok = this.waitFor((l) => l === "uciok");
    this.send("uci");
    await uciok;
    await this.sync();
  }

  private async sync(): Promise<void> {
    const readyok = this.waitFor((l) => l === "readyok");
    this.send("isready");
    await readyok;
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => {});
    return run;
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Applies options right before the next search, so changes made mid-game take effect. */
  configure(options: Record<string, EngineOption>): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      for (const [name, value] of Object.entries(options)) {
        this.send(`setoption name ${name} value ${value}`);
      }
      await this.sync();
    });
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      this.send("ucinewgame");
      await this.sync();
    });
  }

  /** Runs `go <goArgs>` on the position and resolves with the final principal variation. */
  search(fen: string, goArgs: string): Promise<Analysis> {
    const epoch = this.stopEpoch;
    return this.enqueue(async () => {
      await this.ready;
      if (epoch !== this.stopEpoch) return { bestMove: null, score: { cp: 0 }, pv: [], depth: 0 };
      let score: Score = { cp: 0 };
      let pv: string[] = [];
      let depth = 0;
      const onInfo = (line: string) => {
        if (!line.startsWith("info ") || !line.includes(" pv ")) return;
        // Bound scores come from an unfinished aspiration re-search; keep the last exact one.
        if (/\b(lowerbound|upperbound)\b/.test(line)) return;
        // Only the main line matters when MultiPV is above 1.
        const multipv = /\bmultipv (\d+)/.exec(line);
        if (multipv && multipv[1] !== "1") return;
        const d = /\bdepth (\d+)/.exec(line);
        const cp = /\bscore cp (-?\d+)/.exec(line);
        const mate = /\bscore mate (-?\d+)/.exec(line);
        if (d) depth = Number(d[1]);
        if (cp) score = { cp: Number(cp[1]) };
        else if (mate) score = { mate: Number(mate[1]) };
        pv = line.slice(line.indexOf(" pv ") + 4).trim().split(/\s+/);
      };
      const done = this.waitFor((l) => l.startsWith("bestmove"), (line) => {
        onInfo(line);
        // Positions with no legal move report "info depth 0 score mate 0" without a pv.
        const mate0 = /^info depth 0 score (mate|cp) (-?\d+)/.exec(line);
        if (mate0) score = mate0[1] === "mate" ? { mate: Number(mate0[2]) } : { cp: Number(mate0[2]) };
      });
      this.send(`position fen ${fen}`);
      this.send(`go ${goArgs}`);
      const line = await done;
      const move = line.split(/\s+/)[1];
      const bestMove = move && move !== "(none)" ? move : null;
      if (bestMove && pv[0] !== bestMove) pv = [bestMove];
      return { bestMove, score, pv, depth };
    });
  }

  /**
   * Ends the current search early (its promise still resolves with the best move so far) and
   * skips searches that are queued but not started yet.
   */
  stop(): void {
    this.stopEpoch++;
    this.send("stop");
  }

  terminate(): void {
    this.worker.terminate();
    const error = (this.failed ??= new Error("Engine terminated"));
    this.errorListeners.forEach((l) => l(error));
    this.lineListeners.clear();
    this.errorListeners.clear();
    this.worker.onmessage = null;
    this.worker.onerror = null;
  }
}

/** How the opponent engine is configured to play at a given rating. */
export interface OpponentProfile {
  options: Record<string, EngineOption>;
  go: string;
  /** Probability of replacing the engine move with a random legal move. */
  randomMoveChance: number;
}

/** Stockfish only calibrates UCI_Elo from 1320 upwards. */
const UCI_ELO_MIN = 1320;

export function opponentProfile(elo: number): OpponentProfile {
  if (elo >= ELO_MAX) {
    return {
      options: { UCI_LimitStrength: false, "Skill Level": 20 },
      go: "movetime 1500",
      randomMoveChance: 0,
    };
  }
  if (elo >= UCI_ELO_MIN) {
    const t = (elo - UCI_ELO_MIN) / (ELO_MAX - UCI_ELO_MIN);
    return {
      options: { UCI_LimitStrength: true, UCI_Elo: elo, "Skill Level": 20 },
      go: `movetime ${Math.round(400 + t * 1000)}`,
      randomMoveChance: 0,
    };
  }
  // Below the calibrated range: shallow searches, low skill and the occasional random move.
  const t = Math.max(0, (elo - ELO_MIN) / (UCI_ELO_MIN - ELO_MIN));
  return {
    options: { UCI_LimitStrength: false, "Skill Level": Math.round(t * 4) },
    go: `depth ${1 + Math.round(t * 5)}`,
    randomMoveChance: 0.3 * (1 - t),
  };
}

/** Full strength settings for the coach that reviews the player's moves. */
export const COACH_OPTIONS: Record<string, EngineOption> = {
  UCI_LimitStrength: false,
  "Skill Level": 20,
  MultiPV: 1,
};
export const COACH_GO = "depth 18 movetime 900";
