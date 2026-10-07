import { Chess, type Color } from "chess.js";

export type GameResult = "1-0" | "0-1" | "1/2-1/2" | "*";

/** A game brought in from elsewhere: its moves and who played them. */
export interface ImportedGame {
  pgn: string;
  white: string;
  black: string;
  result: GameResult;
  event: string | null;
  date: string | null;
  plies: number;
}

export type ParseResult = { ok: true; game: ImportedGame } | { ok: false; error: string };

/** Longest PGN accepted, generous for one game with clock comments. */
export const MAX_PGN_LENGTH = 100_000;
const RESULTS: GameResult[] = ["1-0", "0-1", "1/2-1/2", "*"];

/** Only the first game of a file with several is read. */
function firstGame(text: string): string {
  const starts = [...text.matchAll(/^\s*\[Event\s/gm)].map((m) => m.index ?? 0);
  return starts.length > 1 ? text.slice(starts[0], starts[1]) : text;
}

const header = (headers: Record<string, string>, key: string) => {
  const value = headers[key]?.trim();
  return value && value !== "?" && value !== "????.??.??" ? value : null;
};

/** Reads a game in PGN, as exported by Lichess, Chess.com and most chess software. */
export function parsePgn(text: string): ParseResult {
  const input = text.trim();
  if (!input) return { ok: false, error: "Paste a game in PGN first." };
  if (input.length > MAX_PGN_LENGTH) return { ok: false, error: "That is too long for one game." };
  const chess = new Chess();
  try {
    chess.loadPgn(firstGame(input));
  } catch (e) {
    const illegal = /Invalid move in PGN: (\S+)/.exec(e instanceof Error ? e.message : "")?.[1];
    return {
      ok: false,
      error: illegal
        ? `${illegal} is not a legal move at that point, so the game cannot be read. Check the whole game was copied.`
        : "That does not read as a PGN game. Copy it again from the site's export or share menu.",
    };
  }
  const plies = chess.history().length;
  if (plies === 0) return { ok: false, error: "That game has no moves." };
  const headers = chess.getHeaders();
  // Move numbers and colours throughout the review assume the usual starting position.
  if (headers.FEN) return { ok: false, error: "Games from a custom starting position cannot be reviewed yet." };
  const result = (RESULTS as string[]).includes(headers.Result) ? (headers.Result as GameResult) : "*";
  return {
    ok: true,
    game: {
      pgn: chess.pgn(),
      white: header(headers, "White") ?? "White",
      black: header(headers, "Black") ?? "Black",
      result,
      event: header(headers, "Event"),
      date: header(headers, "Date"),
      plies,
    },
  };
}

/** The winner a result names, or null for a draw or an unfinished game. */
export function resultWinner(result: GameResult): Color | null {
  return result === "1-0" ? "w" : result === "0-1" ? "b" : null;
}

/** Guesses which side the player was from a name they used before, if it matches exactly one side. */
export function guessSide(game: ImportedGame, knownName: string | null): Color | null {
  if (!knownName) return null;
  const name = knownName.trim().toLowerCase();
  const white = game.white.toLowerCase() === name;
  const black = game.black.toLowerCase() === name;
  return white === black ? null : white ? "w" : "b";
}
