import { useSyncExternalStore } from "react";
import { Chess, type Color } from "chess.js";
import type { Annotation } from "./coach";
import type { GameResult } from "./pgn";

/**
 * Games the player played on other sites, fetched by username and graded in the background, so
 * the coach has their real games without any copying and pasting.
 */
export type Site = "lichess" | "chesscom";

export const SITE_NAME: Record<Site, string> = { lichess: "Lichess", chesscom: "Chess.com" };

export interface SyncedGame {
  /** `<site>-<the site's game id>`; also the game's id in the training records. */
  id: string;
  site: Site;
  url: string;
  pgn: string;
  white: string;
  black: string;
  playerColor: Color;
  result: GameResult;
  /** Bullet, blitz, rapid, classical or correspondence, as the site names it. */
  speed: string;
  opening: string | null;
  opponentRating: number | null;
  playedAt: number;
  /** The coach's grades, once the background grader has been through the game. */
  annotations: (Annotation | null)[] | null;
  failed?: boolean;
}

export interface Account {
  site: Site;
  username: string;
  /** When games were last fetched, and the newest game seen, to fetch only what is new. */
  checkedAt: number;
  newestAt: number;
}

interface SyncState {
  accounts: Account[];
  games: SyncedGame[];
}

const STORAGE_KEY = "chess3d.sync.v1";
/** Games kept, most recent first; older ones have already fed the puzzles and patterns. */
const MAX_GAMES = 60;
/** Games fetched in one go: the first link and every check after that. */
export const FETCH_MAX = 20;
/** A visit after this long checks for new games without being asked. */
export const AUTO_CHECK_MS = 30 * 60 * 1000;

const EMPTY: SyncState = { accounts: [], games: [] };

function read(): SyncState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<SyncState> | null;
    if (!raw || !Array.isArray(raw.accounts) || !Array.isArray(raw.games)) return EMPTY;
    const known = (site: unknown) => site === "lichess" || site === "chesscom";
    return {
      accounts: raw.accounts.filter((a) => known(a?.site) && typeof a.username === "string"),
      games: raw.games.filter((g) => known(g?.site)),
    };
  } catch {
    return EMPTY;
  }
}

let current: SyncState | null = null;
const listeners = new Set<() => void>();

export function getSync(): SyncState {
  if (typeof window === "undefined") return EMPTY;
  current ??= read();
  return current;
}

function write(next: SyncState): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be full or blocked; the games simply are not kept for next time.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
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

export function useSync(): SyncState {
  return useSyncExternalStore(subscribe, getSync, () => EMPTY);
}

export function linkAccount(site: Site, username: string): void {
  const state = getSync();
  const accounts = state.accounts.filter((a) => a.site !== site);
  // A different account's games are not this player's any more.
  const games = state.games.filter((g) => g.site !== site);
  write({ accounts: [...accounts, { site, username, checkedAt: 0, newestAt: 0 }], games });
}

export function unlinkAccount(site: Site): void {
  const state = getSync();
  write({ accounts: state.accounts.filter((a) => a.site !== site), games: state.games.filter((g) => g.site !== site) });
}

/** Stores fetched games, skipping ones already known; returns how many were new. */
export function addGames(site: Site, games: SyncedGame[], checkedAt = Date.now()): number {
  const state = getSync();
  const known = new Set(state.games.map((g) => g.id));
  const fresh = games.filter((g) => !known.has(g.id));
  const merged = [...fresh, ...state.games].sort((a, b) => b.playedAt - a.playedAt).slice(0, MAX_GAMES);
  const newest = Math.max(0, ...games.map((g) => g.playedAt));
  write({
    accounts: state.accounts.map((a) => (a.site === site ? { ...a, checkedAt, newestAt: Math.max(a.newestAt, newest) } : a)),
    games: merged,
  });
  return fresh.length;
}

export function setGrades(id: string, annotations: (Annotation | null)[] | null, failed = false): void {
  const state = getSync();
  write({ ...state, games: state.games.map((g) => (g.id === id ? { ...g, annotations, failed } : g)) });
}

/** The next game the background grader should take, oldest first so patterns build in order. */
export function nextUngraded(state: SyncState): SyncedGame | null {
  const waiting = state.games.filter((g) => !g.annotations && !g.failed);
  return waiting.at(-1) ?? null;
}

const LICHESS = "https://lichess.org";
const SPEEDS = "ultraBullet,bullet,blitz,rapid,classical,correspondence";

export class SyncError extends Error {}

/** Checks a Lichess account exists, returning its name as Lichess writes it. */
export async function lichessUser(username: string): Promise<string> {
  const name = username.trim();
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) throw new SyncError("That is not a Lichess username.");
  const res = await fetch(`${LICHESS}/api/user/${encodeURIComponent(name)}`).catch(() => null);
  if (!res) throw new SyncError("Lichess could not be reached. Check your connection.");
  if (res.status === 404) throw new SyncError(`No Lichess player is called ${name}.`);
  if (res.status === 429) throw new SyncError("Lichess asked us to slow down. Try again in a minute.");
  if (!res.ok) throw new SyncError("Lichess did not answer properly. Try again later.");
  const user = (await res.json()) as { username?: string; disabled?: boolean; tosViolation?: boolean };
  if (user.disabled) throw new SyncError("That Lichess account is closed.");
  return user.username ?? name;
}

/** Splits a multi-game PGN export into single games. */
export function splitPgn(text: string): string[] {
  return text
    .split(/\n\s*\n(?=\[Event )/)
    .map((g) => g.trim())
    .filter(Boolean);
}

/** The speed Lichess files a game under: its base time plus forty increments, in seconds. */
export function speedOf(timeControl: string): string {
  const m = /^(\d+)\+(\d+)$/.exec(timeControl);
  if (!m) return "correspondence";
  const estimate = Number(m[1]) + 40 * Number(m[2]);
  if (estimate < 30) return "ultrabullet";
  if (estimate < 180) return "bullet";
  if (estimate < 480) return "blitz";
  if (estimate < 1500) return "rapid";
  return "classical";
}

/** Reads one game from a Lichess export, or null for a variant or a game the player is not in. */
export function lichessGame(pgn: string, username: string): SyncedGame | null {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const h = chess.getHeaders();
  if ((h.Variant && h.Variant !== "Standard") || h.FEN || chess.history().length < 2) return null;
  const me = username.toLowerCase();
  const playerColor: Color | null = h.White?.toLowerCase() === me ? "w" : h.Black?.toLowerCase() === me ? "b" : null;
  if (!playerColor) return null;
  const site = h.Site ?? "";
  const gameId = h.GameId ?? site.split("/").pop() ?? "";
  if (!gameId) return null;
  const result = (["1-0", "0-1", "1/2-1/2"] as const).find((r) => r === h.Result) ?? "*";
  const when = Date.parse(`${(h.UTCDate ?? h.Date ?? "").replace(/\./g, "-")}T${h.UTCTime ?? "00:00:00"}Z`);
  const rating = Number(playerColor === "w" ? h.BlackElo : h.WhiteElo);
  return {
    id: `lichess-${gameId}`,
    site: "lichess",
    url: `${LICHESS}/${gameId}${playerColor === "b" ? "/black" : ""}`,
    pgn: chess.pgn(),
    white: h.White ?? "White",
    black: h.Black ?? "Black",
    playerColor,
    result,
    speed: speedOf(h.TimeControl ?? "-"),
    opening: h.Opening && h.Opening !== "?" ? h.Opening : null,
    opponentRating: Number.isFinite(rating) && rating > 0 ? rating : null,
    playedAt: Number.isFinite(when) ? when : Date.now(),
    annotations: null,
  };
}

/** Fetches the player's latest finished games from Lichess, newer than `since` when given. */
export async function fetchLichessGames(username: string, since = 0): Promise<SyncedGame[]> {
  const params = new URLSearchParams({ max: String(FETCH_MAX), perfType: SPEEDS, opening: "true", finished: "true" });
  if (since > 0) params.set("since", String(since + 1));
  const res = await fetch(`${LICHESS}/api/games/user/${encodeURIComponent(username)}?${params}`, {
    headers: { Accept: "application/x-chess-pgn" },
  }).catch(() => null);
  if (!res) throw new SyncError("Lichess could not be reached. Check your connection.");
  if (res.status === 429) throw new SyncError("Lichess asked us to slow down. Try again in a minute.");
  if (!res.ok) throw new SyncError("Lichess did not send the games. Try again later.");
  return splitPgn(await res.text())
    .map((pgn) => lichessGame(pgn, username))
    .filter((g): g is SyncedGame => g !== null);
}
