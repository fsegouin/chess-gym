import { Chess, type Color } from "chess.js";
import type { GameResult } from "./pgn";
import { FETCH_MAX, SyncError, type SyncedGame } from "./sync";

const API = "https://api.chess.com/pub";
const START = new Chess().fen();

/** A game as Chess.com's public API lists it in a player's monthly archive. */
interface ArchiveGame {
  url: string;
  pgn?: string;
  end_time: number;
  rules: string;
  time_class: string;
  initial_setup?: string;
  eco?: string;
  white: { username: string; rating?: number; result: string };
  black: { username: string; rating?: number; result: string };
}

/** The opening named in Chess.com's opening link, without the move sequence it ends with. */
export function openingFromUrl(url: string | undefined): string | null {
  const slug = url?.split("/openings/")[1];
  if (!slug) return null;
  const words = decodeURIComponent(slug).split("-");
  const cut = words.findIndex((w) => /^\d+\./.test(w));
  const name = (cut >= 0 ? words.slice(0, cut) : words).join(" ").trim();
  return name || null;
}

/** Reads one archived game, or null for a variant, a custom start or a game the player is not in. */
export function chessComGame(game: ArchiveGame, username: string): SyncedGame | null {
  if (game.rules !== "chess" || !game.pgn) return null;
  if (game.initial_setup && game.initial_setup !== START) return null;
  const me = username.toLowerCase();
  const playerColor: Color | null =
    game.white.username.toLowerCase() === me ? "w" : game.black.username.toLowerCase() === me ? "b" : null;
  if (!playerColor) return null;
  const chess = new Chess();
  try {
    chess.loadPgn(game.pgn);
  } catch {
    return null;
  }
  if (chess.history().length < 2) return null;
  // Chess.com marks the winner; every other ending in a finished archive game is a draw.
  const result: GameResult = game.white.result === "win" ? "1-0" : game.black.result === "win" ? "0-1" : "1/2-1/2";
  const opponent = playerColor === "w" ? game.black : game.white;
  const id = game.url.split("/").pop() ?? String(game.end_time);
  return {
    id: `chesscom-${id}`,
    site: "chesscom",
    url: game.url,
    pgn: chess.pgn(),
    white: game.white.username,
    black: game.black.username,
    playerColor,
    result,
    speed: game.time_class === "daily" ? "correspondence" : game.time_class,
    opening: openingFromUrl(game.eco),
    opponentRating: opponent.rating ?? null,
    playedAt: game.end_time * 1000,
    annotations: null,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url).catch(() => null);
  if (!res) throw new SyncError("Chess.com could not be reached. Check your connection.");
  if (res.status === 404) throw new SyncError("not-found");
  if (res.status === 429) throw new SyncError("Chess.com asked us to slow down. Try again in a minute.");
  if (!res.ok) throw new SyncError("Chess.com did not answer properly. Try again later.");
  return (await res.json()) as T;
}

/** Checks a Chess.com account exists; Chess.com keeps usernames in lower case. */
export async function chessComUser(username: string): Promise<string> {
  const name = username.trim();
  if (!/^[A-Za-z0-9_-]{3,25}$/.test(name)) throw new SyncError("That is not a Chess.com username.");
  try {
    const user = await getJson<{ username?: string; status?: string }>(`${API}/player/${encodeURIComponent(name.toLowerCase())}`);
    if (user.status?.startsWith("closed")) throw new SyncError("That Chess.com account is closed.");
    return name;
  } catch (e) {
    if (e instanceof SyncError && e.message === "not-found") throw new SyncError(`No Chess.com player is called ${name}.`);
    throw e;
  }
}

/** Fetches the player's latest games from the most recent monthly archives, newer than `since`. */
export async function fetchChessComGames(username: string, since = 0): Promise<SyncedGame[]> {
  const user = encodeURIComponent(username.toLowerCase());
  const { archives = [] } = await getJson<{ archives?: string[] }>(`${API}/player/${user}/games/archives`).catch((e: unknown) => {
    if (e instanceof SyncError && e.message === "not-found") throw new SyncError(`No Chess.com player is called ${username}.`);
    throw e;
  });
  const found: SyncedGame[] = [];
  // Newest months first; two are plenty for twenty games unless the player is very occasional.
  for (const month of archives.slice(-3).reverse()) {
    if (!month.startsWith(`${API}/player/`)) continue;
    const { games = [] } = await getJson<{ games?: ArchiveGame[] }>(month);
    for (const g of games) {
      if (g.end_time * 1000 <= since) continue;
      const synced = chessComGame(g, username);
      if (synced) found.push(synced);
    }
    if (found.length >= FETCH_MAX) break;
  }
  return found.sort((a, b) => b.playedAt - a.playedAt).slice(0, FETCH_MAX);
}
