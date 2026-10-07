import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import { classify, negate, shouldPause, type Annotation, type MoveClass } from "./coach";
import { COACH_GO, COACH_OPTIONS, Engine, opponentProfile, type Analysis, type Score } from "./engine";
import { getSettings, type PlayerColorChoice } from "./settings";
import { playSound } from "./sound";

export interface HistoryEntry {
  san: string;
  color: Color;
  from: Square;
  to: Square;
  annotation: Annotation | null;
}

export type GameStatus =
  | { kind: "playing" }
  | { kind: "checkmate"; winner: Color }
  | { kind: "draw"; reason: "stalemate" | "repetition" | "insufficient material" | "fifty-move rule" };

export interface Arrow {
  from: Square;
  to: Square;
  kind: "best" | "threat" | "hint";
}

/** A paused training moment: the player's last move crossed the review threshold. */
export interface Review {
  san: string;
  annotation: Annotation;
  threatSan: string | null;
  threatUci: string | null;
  showBest: boolean;
  showThreat: boolean;
}

export interface Feedback {
  id: number;
  cls: MoveClass;
  san: string;
}

export interface GameSnapshot {
  fen: string;
  /** Changes whenever the position changes, including undo and new game. */
  positionId: number;
  /** The move that produced this position, when it should be animated forwards. */
  animate: { from: Square; to: Square } | null;
  history: HistoryEntry[];
  turn: Color;
  playerColor: Color;
  status: GameStatus;
  checkSquare: Square | null;
  lastMove: { from: Square; to: Square } | null;
  thinking: boolean;
  reviewing: boolean;
  hintPending: boolean;
  /** Latest coach evaluation, from White's point of view. */
  evaluation: Score | null;
  review: Review | null;
  arrows: Arrow[];
  feedback: Feedback | null;
  engineError: string | null;
}

export interface LegalTarget {
  to: Square;
  capture: boolean;
  promotion: boolean;
}

interface SavedGame {
  pgn: string;
  playerColor: Color;
  annotations: (Annotation | null)[];
}

const SAVE_KEY = "chess3d.game.v1";
const MIN_REPLY_MS = 450;
const ANALYSIS_CACHE_SIZE = 64;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function uciToMove(uci: string): { from: Square; to: Square; promotion?: PieceSymbol } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: (uci[4] as PieceSymbol | undefined) || undefined,
  };
}

function moveToUci(move: { from: Square; to: Square; promotion?: PieceSymbol }): string {
  return move.from + move.to + (move.promotion ?? "");
}

function uciToSan(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  try {
    return new Chess(fen).move(uciToMove(uci)).san;
  } catch {
    return null;
  }
}

const MOVE_CLASSES: readonly MoveClass[] = ["best", "good", "inaccuracy", "mistake", "blunder"];

function isScore(value: unknown): value is Score {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.cp === "number" || typeof v.mate === "number";
}

/** Saved games can be stale or hand-edited; drop grades that would not render. */
function isAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return MOVE_CLASSES.includes(v.cls as MoveClass) && isScore(v.before) && isScore(v.after);
}

function resolveColor(choice: PlayerColorChoice): Color {
  if (choice === "random") return Math.random() < 0.5 ? "w" : "b";
  return choice;
}

export class GameController {
  private chess = new Chess();
  /** One entry per ply, aligned with the move history. */
  private annotations: (Annotation | null)[] = [];
  private playerColor: Color = "w";
  private opponent: Engine | null = null;
  private coach: Engine | null = null;
  private analysisCache = new Map<string, Promise<Analysis>>();
  /** Bumped on undo, new game and dispose so stale async results are dropped. */
  private token = 0;
  private positionId = 0;
  private feedbackId = 0;
  private disposed = true;
  private listeners = new Set<() => void>();
  private ui = {
    animate: null as GameSnapshot["animate"],
    thinking: false,
    reviewing: false,
    hintPending: false,
    evaluation: null as Score | null,
    review: null as Review | null,
    arrows: [] as Arrow[],
    feedback: null as Feedback | null,
    engineError: null as string | null,
  };
  private snapshot: GameSnapshot;

  constructor() {
    this.restore();
    this.snapshot = this.build();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GameSnapshot => this.snapshot;

  private emit(positionChanged = false): void {
    if (positionChanged) this.positionId++;
    this.snapshot = this.build();
    this.listeners.forEach((l) => l());
  }

  /**
   * History, status, check square and last move change only with the position. Every chess
   * mutation is followed by emit(true), so later emits reuse them; chess.js replays the whole
   * game to detect repetition.
   */
  private derived: {
    positionId: number;
    moves: Move[];
    status: GameStatus;
    checkSquare: Square | null;
    lastMove: GameSnapshot["lastMove"];
  } | null = null;

  private build(): GameSnapshot {
    if (this.derived?.positionId !== this.positionId) {
      const moves = this.chess.history({ verbose: true });
      const last = moves.at(-1);
      this.derived = {
        positionId: this.positionId,
        moves,
        status: this.status(),
        checkSquare: this.checkSquare(),
        lastMove: last ? { from: last.from, to: last.to } : null,
      };
    }
    const { moves, status, checkSquare, lastMove } = this.derived;
    const history = moves.map<HistoryEntry>((m, i) => ({
      san: m.san,
      color: m.color,
      from: m.from,
      to: m.to,
      annotation: this.annotations[i] ?? null,
    }));
    return {
      fen: this.chess.fen(),
      positionId: this.positionId,
      animate: this.ui.animate,
      history,
      turn: this.chess.turn(),
      playerColor: this.playerColor,
      status,
      checkSquare,
      lastMove,
      thinking: this.ui.thinking,
      reviewing: this.ui.reviewing,
      hintPending: this.ui.hintPending,
      evaluation: this.ui.evaluation,
      review: this.ui.review,
      arrows: this.ui.arrows,
      feedback: this.ui.feedback,
      engineError: this.ui.engineError,
    };
  }

  private status(): GameStatus {
    const c = this.chess;
    if (c.isCheckmate()) return { kind: "checkmate", winner: c.turn() === "w" ? "b" : "w" };
    if (c.isStalemate()) return { kind: "draw", reason: "stalemate" };
    if (c.isInsufficientMaterial()) return { kind: "draw", reason: "insufficient material" };
    if (c.isThreefoldRepetition()) return { kind: "draw", reason: "repetition" };
    if (c.isDrawByFiftyMoves()) return { kind: "draw", reason: "fifty-move rule" };
    return { kind: "playing" };
  }

  private checkSquare(): Square | null {
    if (!this.chess.inCheck()) return null;
    const turn = this.chess.turn();
    for (const row of this.chess.board()) {
      for (const p of row) if (p && p.type === "k" && p.color === turn) return p.square;
    }
    return null;
  }

  private isOver(): boolean {
    return this.chess.isGameOver();
  }

  /** Starts engines as needed. Safe to call again after dispose (React strict mode does this). */
  start(): void {
    this.disposed = false;
    this.advance();
  }

  dispose(): void {
    this.disposed = true;
    this.token++;
    this.opponent?.terminate();
    this.coach?.terminate();
    this.opponent = null;
    this.coach = null;
    this.analysisCache.clear();
    this.ui.thinking = false;
    this.ui.reviewing = false;
    this.ui.hintPending = false;
  }

  /** Re-evaluates what should happen next, e.g. after a settings change. */
  refresh(): void {
    if (getSettings().mode === "play" && this.ui.review) {
      this.ui.review = null;
      this.ui.arrows = [];
      this.emit();
      this.advance();
      return;
    }
    if (getSettings().mode === "play" && this.ui.arrows.length) {
      this.ui.arrows = [];
      this.emit();
    }
    if (getSettings().mode === "training" && !this.ui.thinking && !this.ui.reviewing) this.advance();
  }

  private advance(): void {
    if (this.disposed || this.isOver() || this.ui.review) return;
    if (this.chess.turn() !== this.playerColor) {
      if (!this.ui.thinking) void this.opponentMove();
    } else if (getSettings().mode === "training") {
      void this.updateEvaluation();
    }
  }

  private getOpponent(): Engine {
    if (!this.opponent) {
      const engine = new Engine();
      this.opponent = engine;
      // Only report failures of the engine still in use, not of one terminated by dispose().
      engine.whenReady().catch((e: Error) => this.opponent === engine && this.fail(e));
    }
    return this.opponent;
  }

  private getCoach(): Engine {
    if (!this.coach) {
      const engine = new Engine();
      this.coach = engine;
      engine.whenReady().catch((e: Error) => this.coach === engine && this.fail(e));
      void engine.configure(COACH_OPTIONS).catch(() => {});
    }
    return this.coach;
  }

  private fail(error: Error): void {
    if (this.disposed) return;
    this.ui.engineError = error.message || "The chess engine stopped responding";
    this.ui.thinking = false;
    this.ui.reviewing = false;
    this.ui.hintPending = false;
    this.emit();
  }

  private analyse(fen: string): Promise<Analysis> {
    let job = this.analysisCache.get(fen);
    if (!job) {
      job = this.getCoach().search(fen, COACH_GO);
      this.analysisCache.set(fen, job);
      job.catch(() => {
        if (this.analysisCache.get(fen) === job) this.analysisCache.delete(fen);
      });
      if (this.analysisCache.size > ANALYSIS_CACHE_SIZE) {
        this.analysisCache.delete(this.analysisCache.keys().next().value!);
      }
    }
    return job;
  }

  private whitePov(score: Score, sideToMove: Color): Score {
    return sideToMove === "w" ? score : negate(score);
  }

  private async updateEvaluation(): Promise<void> {
    const token = this.token;
    const fen = this.chess.fen();
    try {
      const a = await this.analyse(fen);
      if (token !== this.token || fen !== this.chess.fen()) return;
      this.ui.evaluation = this.whitePov(a.score, this.chess.turn());
      this.emit();
    } catch (e) {
      if (token === this.token) this.fail(e as Error);
    }
  }

  canMove(): boolean {
    return (
      !this.isOver() &&
      this.chess.turn() === this.playerColor &&
      !this.ui.thinking &&
      !this.ui.reviewing &&
      !this.ui.review
    );
  }

  pieceAt(square: Square): { type: PieceSymbol; color: Color } | null {
    return this.chess.get(square) ?? null;
  }

  legalTargets(from: Square): LegalTarget[] {
    const seen = new Map<Square, LegalTarget>();
    for (const m of this.chess.moves({ square: from, verbose: true })) {
      // Promotions produce four moves to the same square; keep one target.
      seen.set(m.to, { to: m.to, capture: Boolean(m.captured), promotion: Boolean(m.promotion) });
    }
    return [...seen.values()];
  }

  async playerMove(from: Square, to: Square, promotion?: PieceSymbol): Promise<boolean> {
    if (!this.canMove()) return false;
    const fenBefore = this.chess.fen();
    let move: Move;
    try {
      move = this.chess.move({ from, to, promotion });
    } catch {
      return false;
    }
    this.annotations[this.chess.history().length - 1] = null;
    this.ui.arrows = [];
    this.ui.feedback = null;
    this.ui.animate = { from, to };
    this.onMoved(move);

    if (getSettings().mode === "training") {
      await this.reviewMove(fenBefore, move);
    } else {
      this.advance();
    }
    return true;
  }

  private async reviewMove(fenBefore: string, move: Move): Promise<void> {
    const token = this.token;
    const fenAfter = this.chess.fen();
    const ply = this.chess.history().length - 1;
    this.ui.reviewing = true;
    this.emit();

    let before: Analysis;
    let after: Analysis;
    try {
      [before, after] = await Promise.all([this.analyse(fenBefore), this.analyse(fenAfter)]);
    } catch (e) {
      if (token === this.token) {
        this.fail(e as Error);
        this.advance();
      }
      return;
    }
    if (token !== this.token) return;

    const played = moveToUci(move);
    const mated = this.chess.isCheckmate();
    // `after` is scored for the opponent, who is now to move.
    const afterForMover: Score = mated ? { mate: 1 } : this.chess.isDraw() ? { cp: 0 } : negate(after.score);
    const cls = mated ? "best" : classify(before.score, afterForMover, before.bestMove === played);
    const annotation: Annotation = {
      cls,
      bestSan: uciToSan(fenBefore, before.bestMove),
      bestUci: before.bestMove,
      before: before.score,
      after: afterForMover,
    };
    this.annotations[ply] = annotation;
    this.ui.reviewing = false;
    this.ui.evaluation = mated
      ? { mate: move.color === "w" ? 1 : -1 }
      : this.whitePov(after.score, this.chess.turn());

    // The player may have switched to Play while the coach was thinking.
    const { mode, pauseOn } = getSettings();
    if (mode === "training" && shouldPause(cls, pauseOn)) {
      this.ui.review = {
        san: move.san,
        annotation,
        threatSan: uciToSan(fenAfter, after.bestMove),
        threatUci: after.bestMove,
        showBest: false,
        showThreat: false,
      };
      if (getSettings().sound) playSound("alert");
      this.save();
      this.emit();
      return;
    }

    this.ui.feedback = { id: ++this.feedbackId, cls, san: move.san };
    this.save();
    this.emit();
    this.advance();
  }

  private async opponentMove(): Promise<void> {
    const token = this.token;
    const fen = this.chess.fen();
    const profile = opponentProfile(getSettings().elo);
    const startedAt = performance.now();
    this.ui.thinking = true;
    this.emit();

    let uci: string | null;
    try {
      const engine = this.getOpponent();
      await engine.configure(profile.options);
      uci = (await engine.search(fen, profile.go)).bestMove;
    } catch (e) {
      if (token === this.token) this.fail(e as Error);
      return;
    }
    if (token !== this.token) return;

    if (!uci || Math.random() < profile.randomMoveChance) {
      const moves = this.chess.moves({ verbose: true });
      const pick = moves[Math.floor(Math.random() * moves.length)];
      if (pick) uci = moveToUci(pick);
    }
    const wait = MIN_REPLY_MS - (performance.now() - startedAt);
    if (wait > 0) await sleep(wait);
    if (token !== this.token || !uci) return;

    let move: Move;
    try {
      move = this.chess.move(uciToMove(uci));
    } catch {
      this.ui.thinking = false;
      this.emit();
      return;
    }
    this.annotations[this.chess.history().length - 1] = null;
    this.ui.thinking = false;
    this.ui.animate = { from: move.from, to: move.to };
    this.ui.arrows = [];
    this.onMoved(move);
    this.advance();
  }

  private onMoved(move: Move): void {
    if (getSettings().sound) {
      if (this.isOver()) playSound("end");
      else if (this.chess.inCheck()) playSound("check");
      else if (move.captured) playSound("capture");
      else playSound("move");
    }
    this.save();
    this.emit(true);
  }

  /** Training: take the reviewed move back and let the player find a better one. */
  retry(): void {
    if (!this.ui.review) return;
    this.token++;
    this.chess.undo();
    this.annotations.length = this.chess.history().length;
    this.ui.review = null;
    this.ui.arrows = [];
    this.ui.animate = null;
    this.save();
    this.emit(true);
    this.advance();
  }

  toggleBest(): void {
    const review = this.ui.review;
    if (!review?.annotation.bestUci) return;
    this.ui.review = { ...review, showBest: !review.showBest };
    this.syncReviewArrows();
  }

  toggleThreat(): void {
    const review = this.ui.review;
    if (!review?.threatUci) return;
    this.ui.review = { ...review, showThreat: !review.showThreat };
    this.syncReviewArrows();
  }

  private syncReviewArrows(): void {
    const r = this.ui.review!;
    const arrows: Arrow[] = [];
    if (r.showBest && r.annotation.bestUci) arrows.push({ ...uciToMove(r.annotation.bestUci), kind: "best" });
    if (r.showThreat && r.threatUci) arrows.push({ ...uciToMove(r.threatUci), kind: "threat" });
    this.ui.arrows = arrows;
    this.emit();
  }

  /** Training: accept the reviewed move and let the opponent reply. */
  keepMove(): void {
    if (!this.ui.review) return;
    const { annotation, san } = this.ui.review;
    this.ui.review = null;
    this.ui.arrows = [];
    this.ui.feedback = { id: ++this.feedbackId, cls: annotation.cls, san };
    this.emit();
    this.advance();
  }

  async hint(): Promise<void> {
    if (!this.canMove() || this.ui.hintPending) return;
    const token = this.token;
    const fen = this.chess.fen();
    this.ui.hintPending = true;
    this.emit();
    try {
      const a = await this.analyse(fen);
      if (token !== this.token) return;
      this.ui.hintPending = false;
      if (fen !== this.chess.fen()) {
        this.emit();
        return;
      }
      this.ui.arrows = a.bestMove ? [{ ...uciToMove(a.bestMove), kind: "hint" }] : [];
      this.ui.evaluation = this.whitePov(a.score, this.chess.turn());
      this.emit();
    } catch (e) {
      if (token === this.token) this.fail(e as Error);
    }
  }

  clearArrows(): void {
    if (!this.ui.arrows.length || this.ui.review) return;
    this.ui.arrows = [];
    this.emit();
  }

  /** Takes back moves until it is the player's turn again, removing at least one of their moves. */
  undo(): void {
    if (this.chess.history().length === 0) return;
    this.interrupt();
    do {
      this.chess.undo();
    } while (this.chess.history().length > 0 && this.chess.turn() !== this.playerColor);
    this.annotations.length = this.chess.history().length;
    this.save();
    this.emit(true);
    this.advance();
  }

  newGame(choice: PlayerColorChoice): void {
    this.interrupt();
    this.chess.reset();
    this.annotations = [];
    this.playerColor = resolveColor(choice);
    this.ui.evaluation = null;
    this.analysisCache.clear();
    void this.opponent?.newGame().catch(() => {});
    this.save();
    this.emit(true);
    this.advance();
  }

  /** Cancels any search in flight and clears transient training state. */
  private interrupt(): void {
    this.token++;
    if (this.ui.thinking) this.opponent?.stop();
    if (this.ui.reviewing || this.ui.hintPending) {
      this.coach?.stop();
      // A stopped search is shallow; do not reuse it later.
      this.analysisCache.clear();
    }
    Object.assign(this.ui, {
      animate: null,
      thinking: false,
      reviewing: false,
      hintPending: false,
      review: null,
      arrows: [],
      feedback: null,
      engineError: null,
    });
  }

  private save(): void {
    const data: SavedGame = {
      pgn: this.chess.pgn(),
      playerColor: this.playerColor,
      annotations: this.annotations,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Ignore quota or privacy-mode errors; the game simply will not resume.
    }
  }

  private restore(): void {
    this.playerColor = resolveColor(getSettings().playerColor);
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<SavedGame>;
      if (data.playerColor !== "w" && data.playerColor !== "b") return;
      if (typeof data.pgn === "string" && data.pgn.trim()) this.chess.loadPgn(data.pgn);
      this.playerColor = data.playerColor;
      const plies = this.chess.history().length;
      const saved = Array.isArray(data.annotations) ? data.annotations : [];
      this.annotations = Array.from({ length: plies }, (_, i) => (isAnnotation(saved[i]) ? saved[i] : null));
    } catch {
      this.chess.reset();
      this.annotations = [];
    }
  }
}
