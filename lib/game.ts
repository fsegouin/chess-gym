import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import { getTimeControl, TIME_CONTROL_IDS } from "./clock";
import { negate, shouldPause, type Annotation, type MoveClass } from "./coach";
import { COACH_GO, COACH_OPTIONS, Engine, opponentProfile, type Analysis, type Score } from "./engine";
import { legalTargets, moveToUci, parseMove, uciToMove, type LegalTarget, type MoveInput } from "./moves";
import { gradeMove, GRADING_GO, uciToSan } from "./grading";
import { resultWinner, type GameResult as PgnResult, type ImportedGame } from "./pgn";
import { recordResult, type GameResult, type RatingRecord } from "./rating";
import { recordFinishedGame } from "./training";
import { getSettings, type PlayerColorChoice } from "./settings";
import { playSound } from "./sound";

export interface HistoryEntry {
  san: string;
  color: Color;
  from: Square;
  to: Square;
  /** Positions before and after the move, for replaying the game. */
  before: string;
  after: string;
  annotation: Annotation | null;
}

export type GameStatus =
  | { kind: "playing" }
  | { kind: "checkmate"; winner: Color }
  | { kind: "timeout"; winner: Color }
  | { kind: "resigned"; winner: Color }
  | {
      kind: "draw";
      reason: "stalemate" | "repetition" | "insufficient material" | "fifty-move rule" | "timeout vs insufficient material";
    }
  /** A game brought in as PGN that did not end on the board: its recorded result stands. */
  | { kind: "imported"; winner: Color | null; result: PgnResult };

/** Who played an imported game, and how it ended. */
export type ImportedInfo = Pick<ImportedGame, "white" | "black" | "result" | "event" | "date">;

/**
 * Clock values in milliseconds: time left with a time control, time used without one.
 * A running clock has `since` (performance.now) added on top by whoever displays it.
 */
export interface ClockSnapshot {
  controlId: string;
  limited: boolean;
  values: Record<Color, number>;
  running: Color | null;
  since: number;
}

export interface Arrow {
  from: Square;
  to: Square;
  kind: "best" | "threat" | "hint" | "played";
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
  clock: ClockSnapshot;
  /** Whether this game counts towards the player's rating. */
  rated: boolean;
  /** The rating change this game produced, once it has ended. */
  ratingRecord: RatingRecord | null;
  /** False until the player starts a game; nothing runs before that. */
  started: boolean;
  /** Identifies the game in training records, e.g. the puzzles it produced. */
  gameId: string;
  /** Set for a game imported as PGN, which is only analysed, never played on. */
  imported: ImportedInfo | null;
  /** The coach's progress through an imported game's moves, while it grades them. */
  importProgress: { done: number; total: number } | null;
}

export type { LegalTarget };

interface SavedClock {
  controlId: string;
  values: Record<Color, number>;
  /** Clock values after each ply; index 0 is the start of the game. */
  history: Record<Color, number>[];
  flagged: Color | null;
}

interface SavedGame {
  pgn: string;
  playerColor: Color;
  annotations: (Annotation | null)[];
  clock?: SavedClock;
  rated?: boolean;
  started?: boolean;
  gameId?: string;
  gameRecorded?: boolean;
  ratedElo?: number;
  ratingRecord?: RatingRecord | null;
  resigned?: Color | null;
  imported?: ImportedInfo | null;
}

const SAVE_KEY = "chess3d.game.v1";
const MIN_REPLY_MS = 450;
const ANALYSIS_CACHE_SIZE = 64;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MOVE_CLASSES: readonly MoveClass[] = ["best", "good", "inaccuracy", "mistake", "blunder"];

function isScore(value: unknown): value is Score {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.cp === "number" || typeof v.mate === "number";
}

/** Saved games can be stale or hand-edited; drop grades that would not render. */
function isImportedInfo(value: unknown): value is ImportedInfo {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.white === "string" && typeof v.black === "string" && ["1-0", "0-1", "1/2-1/2", "*"].includes(v.result as string);
}

function isAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return MOVE_CLASSES.includes(v.cls as MoveClass) && isScore(v.before) && isScore(v.after);
}

function isClockValues(value: unknown): value is Record<Color, number> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Number.isFinite(v.w) && Number.isFinite(v.b) && (v.w as number) >= 0 && (v.b as number) >= 0;
}

function newClock(controlId: string): SavedClock {
  const control = getTimeControl(controlId);
  const start = control ? control.initialMs : 0;
  const values = { w: start, b: start };
  return { controlId: control ? controlId : "none", values, history: [{ ...values }], flagged: null };
}

/** True when `color` cannot possibly deliver mate: a bare king, or king and one minor piece. */
function cannotMate(chess: Chess, color: Color): boolean {
  const pieces = chess.board().flat().filter((p) => p && p.color === color && p.type !== "k");
  return pieces.length === 0 || (pieces.length === 1 && (pieces[0]!.type === "b" || pieces[0]!.type === "n"));
}

function newGameId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
    importProgress: null as GameSnapshot["importProgress"],
  };
  private imported: ImportedInfo | null = null;
  private gradingToken = -1;
  private snapshot: GameSnapshot;
  private clock: SavedClock = newClock("none");
  private clockRunning: Color | null = null;
  private clockSince = 0;
  private flagTimer = 0;
  private hidden = false;
  private rated = false;
  /** Engine strength when the rated game started; changing it mid-game makes the game unrated. */
  private ratedElo = 0;
  private ratingRecord: RatingRecord | null = null;
  private started = false;
  /** Identifies the game in training records; a finished game is recorded once. */
  private gameId = newGameId();
  private gameRecorded = false;
  private resigned: Color | null = null;

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
    this.syncClock();
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
      before: m.before,
      after: m.after,
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
      clock: {
        controlId: this.clock.controlId,
        limited: getTimeControl(this.clock.controlId) !== null,
        values: { ...this.clock.values },
        running: this.clockRunning,
        since: this.clockSince,
      },
      rated: this.rated,
      ratingRecord: this.ratingRecord,
      started: this.started,
      gameId: this.gameId,
      imported: this.imported,
      importProgress: this.ui.importProgress,
    };
  }

  private status(): GameStatus {
    const c = this.chess;
    if (this.resigned) return { kind: "resigned", winner: this.resigned === "w" ? "b" : "w" };
    const flagged = this.clock.flagged;
    if (flagged) {
      const winner = flagged === "w" ? "b" : "w";
      return cannotMate(c, winner) ? { kind: "draw", reason: "timeout vs insufficient material" } : { kind: "timeout", winner };
    }
    if (c.isCheckmate()) return { kind: "checkmate", winner: c.turn() === "w" ? "b" : "w" };
    if (c.isStalemate()) return { kind: "draw", reason: "stalemate" };
    if (c.isInsufficientMaterial()) return { kind: "draw", reason: "insufficient material" };
    if (c.isThreefoldRepetition()) return { kind: "draw", reason: "repetition" };
    if (c.isDrawByFiftyMoves()) return { kind: "draw", reason: "fifty-move rule" };
    if (this.imported) return { kind: "imported", winner: resultWinner(this.imported.result), result: this.imported.result };
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
    return this.imported !== null || this.resigned !== null || this.clock.flagged !== null || this.chess.isGameOver();
  }

  /** Starts engines and clocks. Safe to call again after dispose (React strict mode does this). */
  start(): void {
    this.disposed = false;
    this.hidden = document.hidden;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    this.emit();
    this.advance();
    // A reload in the middle of grading an imported game carries on where it stopped.
    if (this.imported) void this.gradeImported();
  }

  dispose(): void {
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    this.syncClock();
    this.save();
    this.token++;
    this.opponent?.terminate();
    this.coach?.terminate();
    this.opponent = null;
    this.coach = null;
    this.analysisCache.clear();
    this.ui.thinking = false;
    this.ui.reviewing = false;
    this.ui.hintPending = false;
    this.ui.importProgress = null;
  }

  /** The clock pauses while the page is hidden; this is a game against the computer. */
  private onVisibility = (): void => {
    this.hidden = document.hidden;
    this.emit();
  };

  private onPageHide = (): void => {
    this.settleClock();
    this.save();
  };

  /** Charges the time since the last settle to the running clock. */
  private settleClock(): void {
    const running = this.clockRunning;
    if (!running) return;
    const now = performance.now();
    const elapsed = now - this.clockSince;
    this.clockSince = now;
    const limited = getTimeControl(this.clock.controlId) !== null;
    this.clock.values[running] = limited
      ? Math.max(0, this.clock.values[running] - elapsed)
      : this.clock.values[running] + elapsed;
  }

  /**
   * Runs the clock of the side to move, except while the game is over, the page is hidden,
   * or the coach is reviewing (training pauses must not cost either player time).
   */
  private syncClock(): void {
    const shouldRun =
      this.started && !this.disposed && !this.hidden && !this.isOver() && !this.ui.reviewing && !this.ui.review
        ? this.chess.turn()
        : null;
    if (shouldRun !== this.clockRunning) {
      this.settleClock();
      this.clockRunning = shouldRun;
      this.clockSince = performance.now();
    }
    window.clearTimeout(this.flagTimer);
    const running = this.clockRunning;
    if (running && getTimeControl(this.clock.controlId)) {
      const left = this.clock.values[running] - (performance.now() - this.clockSince);
      this.flagTimer = window.setTimeout(this.checkFlag, Math.max(0, left) + 20);
    }
  }

  private checkFlag = (): void => {
    const running = this.clockRunning;
    if (!running) return;
    this.settleClock();
    if (this.clock.values[running] > 0) {
      this.syncClock();
      return;
    }
    this.interrupt();
    this.clock.flagged = running;
    this.settleRating();
    if (getSettings().sound) playSound("end");
    this.save();
    this.emit(true);
  };

  /** Time a player has left (or has used, without a time control), including the running stretch. */
  private clockValue(color: Color): number {
    const base = this.clock.values[color];
    if (this.clockRunning !== color) return base;
    const elapsed = performance.now() - this.clockSince;
    return getTimeControl(this.clock.controlId) ? Math.max(0, base - elapsed) : base + elapsed;
  }

  /** Brings the clocks back to how they stood after the current ply, e.g. after undo. */
  private rewindClock(): void {
    const plies = this.chess.history().length;
    this.clockRunning = null;
    this.clock.flagged = null;
    this.clock.history.length = Math.min(this.clock.history.length, plies + 1);
    const at = this.clock.history[plies] ?? this.clock.history.at(-1)!;
    this.clock.values = { ...at };
  }

  /** Keeps the engine within its own clock: about a thirtieth of what is left, plus most of the increment. */
  private budgetGo(go: string): string {
    const control = getTimeControl(this.clock.controlId);
    if (!control) return go;
    const left = this.clockValue(this.chess.turn());
    const budget = Math.round(Math.max(50, Math.min(left / 30 + control.incrementMs * 0.8, left * 0.5)));
    const movetime = /movetime (\d+)/.exec(go);
    if (movetime) return go.replace(movetime[0], `movetime ${Math.min(Number(movetime[1]), budget)}`);
    return `${go} movetime ${budget}`;
  }

  /** Re-evaluates what should happen next, e.g. after a settings change. */
  refresh(): void {
    const s = getSettings();
    if (this.rated && !this.isOver() && (s.mode !== "play" || s.elo !== this.ratedElo)) {
      this.rated = false;
      this.save();
      this.emit();
    }
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
    if (!this.started || this.disposed || this.isOver() || this.ui.review) return;
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
    this.ui.importProgress = null;
    this.emit();
  }

  private analyse(fen: string, go = COACH_GO): Promise<Analysis> {
    let job = this.analysisCache.get(fen);
    if (!job) {
      job = this.getCoach().search(fen, go);
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
      this.started &&
      !this.isOver() &&
      this.chess.turn() === this.playerColor &&
      !this.ui.thinking &&
      !this.ui.reviewing &&
      !this.ui.review
    );
  }

  parseMove(text: string): MoveInput | null {
    return parseMove(this.chess, text);
  }

  pieceAt(square: Square): { type: PieceSymbol; color: Color } | null {
    return this.chess.get(square) ?? null;
  }

  legalTargets(from: Square): LegalTarget[] {
    return legalTargets(this.chess, from);
  }

  /** The coach's evaluation of a position, from the side to move; shared with puzzles. */
  scorePosition(fen: string): Promise<Score> {
    return this.analyse(fen).then((a) => a.score);
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
        if (this.isOver()) this.recordGame(true);
      }
      return;
    }
    if (token !== this.token) return;

    const mated = this.chess.isCheckmate();
    const annotation = gradeMove(move, before, after, mated, this.chess.isDraw());
    const cls = annotation.cls;
    this.annotations[ply] = annotation;
    const { mode, pauseOn } = getSettings();
    // The player may have switched to Play while the coach was thinking.
    const pause = mode === "training" && shouldPause(cls, pauseOn);
    // A paused final move can still be retried, so the game is recorded once it is kept.
    if (this.isOver() && !pause) this.recordGame();
    this.ui.reviewing = false;
    this.ui.evaluation = mated
      ? { mate: move.color === "w" ? 1 : -1 }
      : this.whitePov(after.score, this.chess.turn());

    if (pause) {
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
      uci = (await engine.search(fen, this.budgetGo(profile.go))).bestMove;
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
    // The short pause that makes instant replies feel natural must not cost a low clock much.
    const pause = getTimeControl(this.clock.controlId)
      ? Math.min(MIN_REPLY_MS, this.clockValue(this.chess.turn()) / 50)
      : MIN_REPLY_MS;
    const wait = pause - (performance.now() - startedAt);
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

  private playerHasMoved(): boolean {
    return this.chess.history({ verbose: true }).some((m) => m.color === this.playerColor);
  }

  /** Whether starting another game now would count as a loss. */
  isRatedInProgress(): boolean {
    return this.rated && !this.isOver() && this.playerHasMoved();
  }

  /** The finished game's result from the player's side; an unfinished import counts as a draw. */
  private playerResult(): GameResult {
    const s = this.status();
    if (s.kind === "checkmate" || s.kind === "timeout" || s.kind === "resigned" || (s.kind === "imported" && s.winner)) {
      return s.winner === this.playerColor ? 1 : 0;
    }
    return 0.5;
  }

  /** Records the result of a finished rated game, once, then the game's training data. */
  private settleRating(): void {
    if (!this.isOver()) return;
    if (this.rated && !this.ratingRecord) this.ratingRecord = recordResult(this.ratedElo, this.playerResult());
    this.recordGame();
  }

  /**
   * Turns the finished game into puzzles and a game record, once per game. `force` records without
   * waiting for the final move's grade, when that grade is not coming.
   */
  private recordGame(force = false): void {
    if (this.gameRecorded || !this.started) return;
    // In training the player's final move is still being graded; reviewMove records afterwards.
    // Resigning cancels that grading, so a resigned game is recorded straight away.
    const plies = this.chess.history().length;
    const last = plies > 0 ? this.chess.history({ verbose: true })[plies - 1] : null;
    const gradePending = last?.color === this.playerColor && !this.annotations[plies - 1] && !this.resigned;
    if (!force && getSettings().mode === "training" && gradePending) return;
    this.gameRecorded = true;
    recordFinishedGame({
      id: this.gameId,
      history: this.build().history,
      playerColor: this.playerColor,
      // An imported game is graded like a training game; its opponent's strength is unknown.
      mode: this.imported ? "training" : getSettings().mode,
      elo: this.imported ? 0 : this.rated ? this.ratedElo : getSettings().elo,
      result: this.playerResult(),
      clockHistory: getTimeControl(this.clock.controlId) ? this.clock.history : null,
    });
  }

  resign(): void {
    if (this.isOver()) return;
    this.settleClock();
    this.interrupt();
    this.resigned = this.playerColor;
    this.settleRating();
    if (getSettings().sound) playSound("end");
    this.save();
    this.emit(true);
  }

  private onMoved(move: Move): void {
    // The mover's clock was running; charge it, add the increment and record the result.
    this.settleClock();
    const control = getTimeControl(this.clock.controlId);
    // A move completed after the flag fell does not save the player, even with an increment.
    if (control && this.clock.values[move.color] <= 0) this.clock.flagged = move.color;
    else if (control) this.clock.values[move.color] += control.incrementMs;
    this.clock.history[this.chess.history().length] = { ...this.clock.values };
    this.clock.history.length = this.chess.history().length + 1;
    this.settleRating();
    if (getSettings().sound) {
      const detail = { piece: move.piece, to: move.to };
      if (this.isOver()) playSound("end", detail);
      else if (this.chess.inCheck()) playSound("check", detail);
      else if (move.isKingsideCastle() || move.isQueensideCastle()) playSound("castle", detail);
      else if (move.captured) playSound("capture", detail);
      else playSound("move", detail);
    }
    this.save();
    this.emit(true);
  }

  /** Training: take the reviewed move back and let the player find a better one. */
  retry(): void {
    if (!this.ui.review) return;
    this.rated = false;
    this.token++;
    this.chess.undo();
    this.annotations.length = this.chess.history().length;
    this.rewindClock();
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
    if (this.isOver()) this.recordGame();
    this.emit();
    this.advance();
  }

  async hint(): Promise<void> {
    if (!this.canMove() || this.ui.hintPending) return;
    this.rated = false;
    this.save();
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
    if (this.chess.history().length === 0 || this.imported) return;
    this.settleClock();
    this.rated = false;
    this.resigned = null;
    // The result stays in the rating history; this game simply no longer shows it.
    this.ratingRecord = null;
    this.interrupt();
    do {
      this.chess.undo();
    } while (this.chess.history().length > 0 && this.chess.turn() !== this.playerColor);
    this.annotations.length = this.chess.history().length;
    this.rewindClock();
    this.save();
    this.emit(true);
    this.advance();
  }

  /**
   * Loads a game played elsewhere for the coach to grade and review. Nothing is played on: it ends
   * where the PGN ends, with the result the PGN records.
   */
  importGame(game: ImportedGame, playerColor: Color, graded?: { gameId: string; annotations: (Annotation | null)[] }): void {
    // Leaving a rated game in progress counts as a loss, as it does online.
    if (this.isRatedInProgress()) recordResult(this.ratedElo, 0);
    this.interrupt();
    this.chess.loadPgn(game.pgn);
    this.rated = false;
    this.ratedElo = 0;
    this.ratingRecord = null;
    this.resigned = null;
    // A game graded in the background arrives with its grades and is already in the training records.
    this.annotations = this.chess.history().map((_, i) => graded?.annotations[i] ?? null);
    this.clock = newClock("none");
    this.clockRunning = null;
    this.started = true;
    this.gameId = graded?.gameId ?? newGameId();
    this.gameRecorded = graded !== undefined;
    this.playerColor = playerColor;
    this.imported = { white: game.white, black: game.black, result: game.result, event: game.event, date: game.date };
    this.ui.evaluation = null;
    this.analysisCache.clear();
    this.save();
    this.emit(true);
    void this.gradeImported();
  }

  /** Grades the player's moves in an imported game one by one, then records it for training. */
  private async gradeImported(): Promise<void> {
    // One grading run per token: a remount or a new game bumps the token and ends the old run.
    if (!this.imported || this.gradingToken === this.token) return;
    const token = this.token;
    this.gradingToken = token;
    const moves = this.chess.history({ verbose: true });
    const mine = moves.map((move, ply) => ({ move, ply })).filter(({ move }) => move.color === this.playerColor);
    const todo = mine.filter(({ ply }) => !this.annotations[ply]);
    if (todo.length > 0) {
      this.ui.importProgress = { done: mine.length - todo.length, total: mine.length };
      this.ui.reviewing = true;
      this.emit();
      for (const { move, ply } of todo) {
        let before: Analysis;
        let after: Analysis;
        try {
          before = await this.analyse(move.before, GRADING_GO);
          after = await this.analyse(move.after, GRADING_GO);
        } catch (e) {
          if (token === this.token) this.fail(e as Error);
          return;
        }
        if (token !== this.token) return;
        const position = new Chess(move.after);
        this.annotations[ply] = gradeMove(move, before, after, position.isCheckmate(), position.isDraw());
        this.ui.importProgress = { done: this.ui.importProgress!.done + 1, total: mine.length };
        this.save();
        this.emit();
      }
      this.ui.importProgress = null;
      this.ui.reviewing = false;
    }
    this.recordGame(true);
    this.save();
    this.emit();
  }

  newGame(choice: PlayerColorChoice, timeControl = getSettings().timeControl): void {
    // Leaving a rated game in progress counts as a loss, as it does online.
    if (this.isRatedInProgress()) recordResult(this.ratedElo, 0);
    const settings = getSettings();
    this.rated = settings.mode === "play";
    this.ratedElo = settings.elo;
    this.ratingRecord = null;
    this.resigned = null;
    this.imported = null;
    this.interrupt();
    this.chess.reset();
    this.annotations = [];
    this.clock = newClock(timeControl);
    this.clockRunning = null;
    this.started = true;
    this.gameId = newGameId();
    this.gameRecorded = false;
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
      importProgress: null,
    });
  }

  private save(): void {
    const data: SavedGame = {
      pgn: this.chess.pgn(),
      playerColor: this.playerColor,
      annotations: this.annotations,
      clock: {
        ...this.clock,
        values: { w: this.clockValue("w"), b: this.clockValue("b") },
      },
      rated: this.rated,
      started: this.started,
      gameId: this.gameId,
      gameRecorded: this.gameRecorded,
      ratedElo: this.ratedElo,
      ratingRecord: this.ratingRecord,
      resigned: this.resigned,
      imported: this.imported,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Ignore quota or privacy-mode errors; the game simply will not resume.
    }
  }

  private restore(): void {
    this.playerColor = resolveColor(getSettings().playerColor);
    this.clock = newClock(getSettings().timeControl);
    this.rated = getSettings().mode === "play";
    this.ratedElo = getSettings().elo;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<SavedGame>;
      if (data.playerColor !== "w" && data.playerColor !== "b") return;
      if (typeof data.pgn === "string" && data.pgn.trim()) this.chess.loadPgn(data.pgn);
      this.playerColor = data.playerColor;
      // Saves from before the start screen existed were always games in progress.
      this.started = data.started !== false;
      if (typeof data.gameId === "string") this.gameId = data.gameId;
      this.gameRecorded = data.gameRecorded === true;
      const plies = this.chess.history().length;
      const saved = Array.isArray(data.annotations) ? data.annotations : [];
      this.annotations = Array.from({ length: plies }, (_, i) => (isAnnotation(saved[i]) ? saved[i] : null));
      this.clock = this.restoreClock(data.clock, plies);
      this.rated = data.rated === true && typeof data.ratedElo === "number";
      this.ratedElo = typeof data.ratedElo === "number" ? data.ratedElo : 0;
      this.ratingRecord = data.ratingRecord ?? null;
      this.resigned = data.resigned === "w" || data.resigned === "b" ? data.resigned : null;
      this.imported = isImportedInfo(data.imported) ? data.imported : null;
      // A reload while the final move was being graded would otherwise leave the game unrecorded.
      // An imported game is recorded once its grading finishes, which start() resumes.
      if (this.isOver() && !this.imported) this.recordGame(true);
    } catch {
      this.chess.reset();
      this.annotations = [];
      this.clock = newClock(getSettings().timeControl);
      this.started = false;
      this.imported = null;
    }
  }

  private restoreClock(saved: SavedClock | undefined, plies: number): SavedClock {
    if (!saved || !TIME_CONTROL_IDS.includes(saved.controlId) || !isClockValues(saved.values)) return newClock("none");
    const history = Array.isArray(saved.history) ? saved.history.filter(isClockValues) : [];
    const fresh = newClock(saved.controlId);
    return {
      controlId: saved.controlId,
      values: { ...saved.values },
      history: history.length === plies + 1 ? history : [...fresh.history],
      flagged: saved.flagged === "w" || saved.flagged === "b" ? saved.flagged : null,
    };
  }
}
