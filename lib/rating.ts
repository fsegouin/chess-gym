import { useSyncExternalStore } from "react";

export type GameResult = 1 | 0.5 | 0;

export interface RatingRecord {
  /** Epoch milliseconds when the game ended. */
  at: number;
  opponent: number;
  result: GameResult;
  change: number;
  rating: number;
}

export interface RatingState {
  rating: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** Most recent first. */
  history: RatingRecord[];
}

export const START_RATING = 1200;
/** Below this many rated games the rating is shown as provisional. */
export const PROVISIONAL_GAMES = 10;
const HISTORY_LIMIT = 50;
const STORAGE_KEY = "chess3d.rating.v1";

const EMPTY: RatingState = { rating: START_RATING, games: 0, wins: 0, draws: 0, losses: 0, history: [] };

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + Math.pow(10, (opponent - rating) / 400));
}

/** Moves faster while the rating is still settling, like most federations do for new players. */
function kFactor(games: number): number {
  return games < 20 ? 40 : 20;
}

function isRecord(value: unknown): value is RatingRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    [v.at, v.opponent, v.change, v.rating].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (v.result === 1 || v.result === 0.5 || v.result === 0)
  );
}

function sanitize(raw: unknown): RatingState {
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
  const rating = typeof r.rating === "number" && Number.isFinite(r.rating) ? Math.round(r.rating) : START_RATING;
  return {
    rating: Math.min(4000, Math.max(100, rating)),
    games: count(r.games),
    wins: count(r.wins),
    draws: count(r.draws),
    losses: count(r.losses),
    history: Array.isArray(r.history) ? r.history.filter(isRecord).slice(0, HISTORY_LIMIT) : [],
  };
}

function read(): RatingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let current: RatingState | null = null;
const listeners = new Set<() => void>();

export function getRating(): RatingState {
  if (typeof window === "undefined") return EMPTY;
  current ??= read();
  return current;
}

function write(next: RatingState): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The rating still updates for this session.
  }
  listeners.forEach((l) => l());
}

/** Applies one rated game against an opponent of the given strength and returns the record. */
export function recordResult(opponent: number, result: GameResult): RatingRecord {
  const state = getRating();
  const change = Math.round(kFactor(state.games) * (result - expectedScore(state.rating, opponent)));
  const rating = Math.max(100, state.rating + change);
  const record: RatingRecord = { at: Date.now(), opponent, result, change, rating };
  write({
    rating,
    games: state.games + 1,
    wins: state.wins + (result === 1 ? 1 : 0),
    draws: state.draws + (result === 0.5 ? 1 : 0),
    losses: state.losses + (result === 0 ? 1 : 0),
    history: [record, ...state.history].slice(0, HISTORY_LIMIT),
  });
  return record;
}

export function resetRating(): void {
  write(EMPTY);
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

export function useRating(): RatingState {
  return useSyncExternalStore(subscribe, getRating, () => EMPTY);
}
