import type { Color } from "chess.js";
import { formatScore, negate, type MoveClass } from "./coach";
import type { Score } from "./engine";
import type { HistoryEntry } from "./game";

/**
 * A written review of the player's own game by a language model. The engine has already graded
 * every move; the model only explains, so the request carries those grades as facts.
 */
export interface GameReview {
  headline: string;
  story: string;
  turningPoints: { ply: number; title: string; text: string }[];
  strengths: string[];
  focus: { title: string; text: string }[];
}

export interface ReviewMove {
  san: string;
  /** The coach's grade, for the player's moves only. */
  cls: MoveClass | null;
  /** Evaluations around a graded move, from the mover's side. */
  before: Score | null;
  after: Score | null;
  best: string | null;
}

export interface ReviewRequest {
  playerColor: Color;
  result: string;
  moves: ReviewMove[];
}

/** Longest game sent for review, far beyond any real game. */
export const MAX_REVIEW_PLIES = 400;

export function reviewRequest(history: HistoryEntry[], playerColor: Color, result: string): ReviewRequest {
  return {
    playerColor,
    result,
    moves: history.slice(0, MAX_REVIEW_PLIES).map((h) => ({
      san: h.san,
      cls: h.annotation?.cls ?? null,
      before: h.annotation?.before ?? null,
      after: h.annotation?.after ?? null,
      best: h.annotation && h.annotation.cls !== "best" ? h.annotation.bestSan : null,
    })),
  };
}

/** One line per ply for the model: the move, and for the player's moves the coach's verdict. */
export function reviewFacts(req: ReviewRequest): string {
  return req.moves
    .map((m, ply) => {
      const color: Color = ply % 2 === 0 ? "w" : "b";
      const label = `${Math.floor(ply / 2) + 1}${color === "w" ? "." : "..."} ${m.san}`;
      const who = color === req.playerColor ? "player" : "opponent";
      const parts = [`ply ${ply}`, label, who];
      if (m.cls && m.before && m.after) {
        // Shown from White's side, like an evaluation bar.
        const white = (s: Score) => formatScore(color === "w" ? s : negate(s));
        parts.push(`eval ${white(m.before)} -> ${white(m.after)}`, `grade ${m.cls}`);
        if (m.best) parts.push(`coach preferred ${m.best}`);
      }
      return parts.join(" | ");
    })
    .join("\n");
}

const NOTES_KEY = "chess3d.notes.v1";
const MAX_NOTES = 30;

/** Reviews are kept per game, so asking again costs nothing. */
export function savedReview(gameId: string): GameReview | null {
  try {
    const all = JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}") as Record<string, GameReview>;
    return all[gameId] ?? null;
  } catch {
    return null;
  }
}

export function saveReview(gameId: string, review: GameReview): void {
  try {
    const all = JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}") as Record<string, GameReview>;
    all[gameId] = review;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_NOTES))) delete all[k];
    localStorage.setItem(NOTES_KEY, JSON.stringify(all));
  } catch {
    // Without storage the review is simply asked for again next time.
  }
}
