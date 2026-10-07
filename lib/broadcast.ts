import type { Color, Square } from "chess.js";
import type { MoveClass } from "./coach";
import type { Score } from "./engine";

/**
 * A famous game with commentary, prepared ahead of time: Stockfish analyses every position, then a
 * language model explains the moves from that analysis. The app only plays it back.
 */
export interface Broadcast {
  slug: string;
  title: string;
  white: string;
  black: string;
  event: string;
  date: string;
  result: string;
  /** Why the game is remembered and what to watch for. */
  summary: string;
  moves: BroadcastMove[];
  /** Short takeaways shown at the end. */
  lessons: string[];
  model: string;
  generatedAt: string;
}

export interface BroadcastMove {
  san: string;
  color: Color;
  from: Square;
  to: Square;
  before: string;
  after: string;
  /** Evaluation after the move, from White's side. */
  evaluation: Score;
  cls: MoveClass;
  /** The engine's preferred move when it differs from the one played. */
  best: { san: string; uci: string } | null;
  comment: string;
  /** Set on the moves that decide the game; playback stops on them. */
  moment: { title: string; text: string } | null;
}

/** One entry in the library listing. */
export type BroadcastSummary = Pick<Broadcast, "slug" | "title" | "white" | "black" | "event" | "date" | "result" | "summary"> & {
  plies: number;
  moments: number;
};

/** How long a comment stays up before playback moves on: enough to read it, never sluggish. */
export function readingDelay(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(7000, Math.max(1800, 900 + words * 220));
}

/** The year of a PGN date such as "1858.??.??", for listings. */
export function yearOf(date: string): string {
  const year = date.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : "";
}
