import { useSyncExternalStore } from "react";
import { Chess } from "chess.js";
import type { Annotation } from "./coach";
import { COACH_OPTIONS, Engine, type Analysis } from "./engine";
import type { HistoryEntry } from "./game";
import { gradeMove, GRADING_GO } from "./grading";
import { getSync, nextUngraded, setGrades, type SyncedGame } from "./sync";
import { recordFinishedGame } from "./training";

/** Which synced game is being graded, and how far it has got. */
export type GraderProgress = { gameId: string; done: number; total: number } | null;

let progress: GraderProgress = null;
const listeners = new Set<() => void>();

function setProgress(next: GraderProgress): void {
  progress = next;
  listeners.forEach((l) => l());
}

export function useGraderProgress(): GraderProgress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => progress,
    () => null,
  );
}

const TERMINAL: Analysis = { bestMove: null, score: { cp: 0 }, pv: [], depth: 0 };

/**
 * Grades synced games one after another with an engine of its own, so the board and the live
 * coach are never kept waiting. Each graded game feeds the puzzles and patterns like a finished
 * training game. `stop` ends the run; the game in hand is picked up again next time.
 */
export class BackgroundGrader {
  private engine: Engine | null = null;
  private stopped = false;

  async run(): Promise<void> {
    try {
      for (let game = nextUngraded(getSync()); game && !this.stopped; game = nextUngraded(getSync())) {
        const annotations = await this.grade(game);
        if (this.stopped) break;
        if (!annotations) continue;
        // An account unlinked while its game was graded takes the game with it.
        if (!getSync().games.some((g) => g.id === game.id)) continue;
        setGrades(game.id, annotations);
        record(game, annotations);
      }
    } finally {
      if (!this.stopped) this.stop();
    }
  }

  stop(): void {
    this.stopped = true;
    this.engine?.terminate();
    this.engine = null;
    setProgress(null);
  }

  private async grade(game: SyncedGame): Promise<(Annotation | null)[] | null> {
    const chess = new Chess();
    try {
      chess.loadPgn(game.pgn);
    } catch {
      setGrades(game.id, null, true);
      return null;
    }
    const moves = chess.history({ verbose: true });
    const mine = moves.filter((m) => m.color === game.playerColor).length;
    const annotations: (Annotation | null)[] = moves.map(() => null);
    this.engine ??= new Engine();
    const engine = this.engine;
    await engine.whenReady();
    await engine.configure(COACH_OPTIONS);
    if (this.stopped) return null;
    let done = 0;
    setProgress({ gameId: game.id, done, total: mine });
    for (const [ply, move] of moves.entries()) {
      if (move.color !== game.playerColor) continue;
      const position = new Chess(move.after);
      const terminal = position.isGameOver();
      const before = await engine.search(move.before, GRADING_GO);
      const after = terminal ? TERMINAL : await engine.search(move.after, GRADING_GO);
      if (this.stopped) return null;
      annotations[ply] = gradeMove(move, before, after, position.isCheckmate(), position.isDraw());
      setProgress({ gameId: game.id, done: ++done, total: mine });
    }
    return annotations;
  }
}

function record(game: SyncedGame, annotations: (Annotation | null)[]): void {
  const chess = new Chess();
  chess.loadPgn(game.pgn);
  const history: HistoryEntry[] = chess.history({ verbose: true }).map((m, i) => ({
    san: m.san,
    color: m.color,
    from: m.from,
    to: m.to,
    before: m.before,
    after: m.after,
    annotation: annotations[i] ?? null,
  }));
  const winner = game.result === "1-0" ? "w" : game.result === "0-1" ? "b" : null;
  recordFinishedGame({
    id: game.id,
    history,
    playerColor: game.playerColor,
    mode: "training",
    elo: game.opponentRating ?? 0,
    result: winner ? (winner === game.playerColor ? 1 : 0) : 0.5,
    clockHistory: null,
    now: game.playedAt,
  });
}
