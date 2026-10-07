import { useSyncExternalStore } from "react";
import type { Color } from "chess.js";
import type { MoveClass } from "./coach";
import type { Score } from "./engine";
import type { HistoryEntry } from "./game";
import { teachingPoint } from "./lesson";
import type { GameMode } from "./settings";

/**
 * Local training memory: puzzles made from the player's own mistakes, scheduled with spaced
 * repetition, and a short record of each finished game for the patterns view.
 */
export type PuzzleKind = "missed-mate" | "missed-forced-mate" | "missed-check" | "missed-capture" | "slip";
export type GamePhase = "opening" | "middlegame" | "endgame";
export type PuzzleResult = "solved" | "failed";

export interface Puzzle {
  id: string;
  /** Position before the player's move; the player is to move. */
  fen: string;
  solution: string;
  solutionSan: string;
  playedSan: string;
  kind: PuzzleKind;
  cls: MoveClass;
  phase: GamePhase;
  /** Coach evaluation before the move, from the player's side, to judge other good answers. */
  bestScore: Score;
  createdAt: number;
  /** Spaced repetition: when it is next shown, the gap in days, and the ease multiplier. */
  due: number;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  lastResult: PuzzleResult | null;
}

export interface GameRecord {
  id: string;
  endedAt: number;
  mode: GameMode;
  playerColor: Color;
  elo: number;
  /** 1 win, 0.5 draw, 0 loss, from the player's side. */
  result: 1 | 0.5 | 0;
  moves: number;
  reviewed: number;
  counts: Record<MoveClass, number>;
  kinds: Record<PuzzleKind, number>;
  phases: Record<GamePhase, number>;
  /** Slips made with under 30 seconds on the clock. */
  timeTrouble: number;
  /** Share of reviewed moves graded best or good; null when nothing was reviewed. */
  accuracy: number | null;
}

interface TrainingState {
  puzzles: Puzzle[];
  games: GameRecord[];
}

const STORAGE_KEY = "chess3d.training.v1";
const MAX_PUZZLES = 400;
const MAX_GAMES = 200;
const DAY = 24 * 60 * 60 * 1000;
/** A failed puzzle comes back later in the same session. */
const RETRY_DELAY = 10 * 60 * 1000;
/** A puzzle counts as mastered once its gap reaches three weeks. */
export const MASTERED_DAYS = 21;
const TIME_TROUBLE_MS = 30_000;

const EMPTY: TrainingState = { puzzles: [], games: [] };
const CLASSES: MoveClass[] = ["best", "good", "inaccuracy", "mistake", "blunder"];
export const PUZZLE_KINDS: PuzzleKind[] = ["missed-mate", "missed-forced-mate", "missed-check", "missed-capture", "slip"];
export const PHASES: GamePhase[] = ["opening", "middlegame", "endgame"];

export const KIND_LABEL: Record<PuzzleKind, string> = {
  "missed-mate": "Missed checkmates",
  "missed-forced-mate": "Missed forced mates",
  "missed-check": "Missed checks",
  "missed-capture": "Missed captures",
  slip: "Other slips",
};

const zero = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

function kindOf(label: string): PuzzleKind {
  if (label === "Missed checkmate") return "missed-mate";
  if (label === "Missed forced mate") return "missed-forced-mate";
  if (label === "Missed check") return "missed-check";
  if (label === "Missed capture") return "missed-capture";
  return "slip";
}

/** Opening for the first ten moves; endgame once at most four pieces besides kings and pawns remain. */
export function phaseOf(fen: string, ply: number): GamePhase {
  const placement = fen.split(" ")[0];
  const pieces = placement.replace(/[^nbrqNBRQ]/g, "").length;
  if (pieces <= 4) return "endgame";
  if (ply < 20) return "opening";
  return "middlegame";
}

function isScore(v: unknown): v is Score {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return typeof s.cp === "number" || typeof s.mate === "number";
}

function sanitize(raw: unknown): TrainingState {
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Record<string, unknown>;
  const puzzles = Array.isArray(r.puzzles)
    ? (r.puzzles as Puzzle[]).filter(
        (p) =>
          p &&
          typeof p.id === "string" &&
          typeof p.fen === "string" &&
          typeof p.solution === "string" &&
          PUZZLE_KINDS.includes(p.kind) &&
          isScore(p.bestScore) &&
          Number.isFinite(p.due),
      )
    : [];
  const games = Array.isArray(r.games)
    ? (r.games as GameRecord[]).filter((g) => g && typeof g.id === "string" && Number.isFinite(g.endedAt))
    : [];
  return { puzzles: puzzles.slice(-MAX_PUZZLES), games: games.slice(0, MAX_GAMES) };
}

function read(): TrainingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let current: TrainingState | null = null;
const listeners = new Set<() => void>();

export function getTraining(): TrainingState {
  if (typeof window === "undefined") return EMPTY;
  current ??= read();
  return current;
}

function write(next: TrainingState): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or blocked; training still works for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    // A null key means another tab cleared all storage.
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    current = read();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTraining(): TrainingState {
  return useSyncExternalStore(subscribe, getTraining, () => EMPTY);
}

export interface FinishedGame {
  id: string;
  history: HistoryEntry[];
  playerColor: Color;
  mode: GameMode;
  elo: number;
  result: 1 | 0.5 | 0;
  /** Clock values after each ply (index 0 is the start), when a time control was used. */
  clockHistory: Record<Color, number>[] | null;
  now?: number;
}

/** Turns a finished game into puzzles and a game record. Recording the same game twice does nothing. */
export function recordFinishedGame(game: FinishedGame): void {
  const state = getTraining();
  if (state.games.some((g) => g.id === game.id)) return;
  const now = game.now ?? Date.now();
  const counts = zero(CLASSES);
  const kinds = zero(PUZZLE_KINDS);
  const phases = zero(PHASES);
  let reviewed = 0;
  let moves = 0;
  let timeTrouble = 0;
  const puzzles: Puzzle[] = [];

  game.history.forEach((entry, ply) => {
    if (entry.color !== game.playerColor) return;
    moves++;
    const a = entry.annotation;
    if (!a) return;
    reviewed++;
    counts[a.cls]++;
    const point = teachingPoint(entry, ply);
    if (!point || !a.bestSan) return;
    const kind = kindOf(point.label);
    const phase = phaseOf(entry.before, ply);
    kinds[kind]++;
    phases[phase]++;
    const left = game.clockHistory?.[ply]?.[game.playerColor];
    if (left !== undefined && left < TIME_TROUBLE_MS) timeTrouble++;
    puzzles.push({
      id: `${game.id}-${ply}`,
      fen: entry.before,
      solution: point.bestUci,
      solutionSan: a.bestSan,
      playedSan: entry.san,
      kind,
      cls: a.cls,
      phase,
      bestScore: a.before,
      createdAt: now,
      due: now,
      interval: 0,
      ease: 2.5,
      reps: 0,
      lapses: 0,
      lastResult: null,
    });
  });

  const record: GameRecord = {
    id: game.id,
    endedAt: now,
    mode: game.mode,
    playerColor: game.playerColor,
    elo: game.elo,
    result: game.result,
    moves,
    reviewed,
    counts,
    kinds,
    phases,
    timeTrouble,
    accuracy: reviewed > 0 ? (counts.best + counts.good) / reviewed : null,
  };
  write({
    puzzles: [...state.puzzles, ...puzzles].slice(-MAX_PUZZLES),
    games: [record, ...state.games].slice(0, MAX_GAMES),
  });
}

/** Spaced repetition in the spirit of SM-2: success stretches the gap, failure resets it. */
export function schedule(p: Puzzle, result: PuzzleResult, now = Date.now()): Puzzle {
  if (result === "failed") {
    return {
      ...p,
      reps: 0,
      lapses: p.lapses + 1,
      interval: 0,
      ease: Math.max(1.3, p.ease - 0.2),
      due: now + RETRY_DELAY,
      lastResult: result,
    };
  }
  const reps = p.reps + 1;
  const interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(p.interval * p.ease);
  return {
    ...p,
    reps,
    interval,
    ease: Math.min(2.8, p.ease + 0.1),
    due: now + interval * DAY,
    lastResult: result,
  };
}

export function gradePuzzle(id: string, result: PuzzleResult, now = Date.now()): void {
  const state = getTraining();
  write({ ...state, puzzles: state.puzzles.map((p) => (p.id === id ? schedule(p, result, now) : p)) });
}

export function duePuzzles(puzzles: Puzzle[], now = Date.now(), kind?: PuzzleKind): Puzzle[] {
  return puzzles.filter((p) => p.due <= now && (!kind || p.kind === kind)).sort((a, b) => a.due - b.due);
}

export function resetTraining(): void {
  write(EMPTY);
}

export interface Insights {
  games: number;
  reviewedGames: number;
  record: { wins: number; draws: number; losses: number };
  /** Accuracy of the last reviewed games, oldest first, for a trend line. */
  accuracyTrend: number[];
  recentAccuracy: number | null;
  previousAccuracy: number | null;
  kinds: Record<PuzzleKind, number>;
  phases: Record<GamePhase, number>;
  timeTrouble: number;
  /** The most frequent kinds of mistake, most common first. */
  focus: PuzzleKind[];
  puzzles: { total: number; due: number; mastered: number };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function insights(state: TrainingState, now = Date.now()): Insights {
  const games = state.games;
  const reviewed = games.filter((g) => g.accuracy !== null);
  const kinds = zero(PUZZLE_KINDS);
  const phases = zero(PHASES);
  let timeTrouble = 0;
  for (const g of games) {
    for (const k of PUZZLE_KINDS) kinds[k] += g.kinds?.[k] ?? 0;
    for (const p of PHASES) phases[p] += g.phases?.[p] ?? 0;
    timeTrouble += g.timeTrouble ?? 0;
  }
  const accuracies = reviewed.map((g) => g.accuracy as number);
  return {
    games: games.length,
    reviewedGames: reviewed.length,
    record: {
      wins: games.filter((g) => g.result === 1).length,
      draws: games.filter((g) => g.result === 0.5).length,
      losses: games.filter((g) => g.result === 0).length,
    },
    accuracyTrend: accuracies.slice(0, 20).reverse(),
    recentAccuracy: mean(accuracies.slice(0, 5)),
    previousAccuracy: mean(accuracies.slice(5, 10)),
    kinds,
    phases,
    timeTrouble,
    focus: PUZZLE_KINDS.filter((k) => kinds[k] > 0).sort((a, b) => kinds[b] - kinds[a]).slice(0, 3),
    puzzles: {
      total: state.puzzles.length,
      due: duePuzzles(state.puzzles, now).length,
      mastered: state.puzzles.filter((p) => p.interval >= MASTERED_DAYS).length,
    },
  };
}
