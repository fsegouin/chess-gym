import type { Score } from "./engine";
import type { PauseThreshold } from "./settings";

export type MoveClass = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

export interface Annotation {
  cls: MoveClass;
  /** SAN of the engine's preferred move in the position before the player's move. */
  bestSan: string | null;
  bestUci: string | null;
  /** Evaluations (centipawns or mate) from the mover's point of view, before and after the move. */
  before: Score;
  after: Score;
}

const MATE_CP = 10000;
const MATE_PLY_COST_CP = 10;
const CP_CLAMP = 1000;
const WIN_CHANCE_SLOPE = 0.00368208;
const BLUNDER_LOSS = 0.3;
const MISTAKE_LOSS = 0.2;
const INACCURACY_LOSS = 0.1;
const MISSED_MATE_STILL_WINNING_CP = 300;

/** Collapses mate scores onto the centipawn scale; nearer mates rank higher. */
export function toCp(score: Score): number {
  if ("cp" in score) return score.cp;
  if (score.mate > 0) return MATE_CP - score.mate * MATE_PLY_COST_CP;
  return -MATE_CP - score.mate * MATE_PLY_COST_CP;
}

export function negate(score: Score): Score {
  return "cp" in score ? { cp: -score.cp } : { mate: -score.mate };
}

/** Maps centipawns to winning chances in [-1, 1], so errors in decided positions weigh less. */
export function winningChances(cp: number): number {
  const clamped = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
  return 2 / (1 + Math.exp(-WIN_CHANCE_SLOPE * clamped)) - 1;
}

export function classify(before: Score, after: Score, playedBest: boolean): MoveClass {
  if (playedBest) return "best";
  // Letting a forced mate slip is never a small error, whatever the remaining advantage.
  const hadMate = "mate" in before && before.mate > 0;
  const keptMate = "mate" in after && after.mate > 0;
  const loss = winningChances(toCp(before)) - winningChances(toCp(after));
  if (loss >= BLUNDER_LOSS) return "blunder";
  // Any remaining eval at or below this already counted as a blunder above.
  if (hadMate && !keptMate && toCp(after) > MISSED_MATE_STILL_WINNING_CP) return "mistake";
  if (loss >= MISTAKE_LOSS) return "mistake";
  if (loss >= INACCURACY_LOSS) return "inaccuracy";
  return "good";
}

const SEVERITY: Record<MoveClass, number> = { best: 0, good: 0, inaccuracy: 1, mistake: 2, blunder: 3 };

export function shouldPause(cls: MoveClass, threshold: PauseThreshold): boolean {
  return SEVERITY[cls] >= SEVERITY[threshold];
}

export const CLASS_LABEL: Record<MoveClass, string> = {
  best: "Best move",
  good: "Good move",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

export const CLASS_GLYPH: Record<MoveClass, string> = {
  best: "!",
  good: "",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

/** Who is ahead and by how much, from White's point of view, in words a newcomer can read. */
export function describeAdvantage(score: Score | null): { side: string; value: string; sentence: string } {
  if (!score) return { side: "Even", value: "0.0", sentence: "No evaluation yet" };
  if ("mate" in score) {
    if (score.mate === 0) return { side: "Mate", value: "#", sentence: "Checkmate" };
    const side = score.mate > 0 ? "White" : "Black";
    const n = Math.abs(score.mate);
    return { side, value: `M${n}`, sentence: `${side} has a forced mate in ${n}` };
  }
  const pawns = Math.abs(score.cp) / 100;
  if (pawns < 0.15) return { side: "Even", value: "0.0", sentence: "The position is about even" };
  const side = score.cp > 0 ? "White" : "Black";
  return { side, value: `+${pawns.toFixed(1)}`, sentence: `${side} is ahead by about ${pawns.toFixed(1)} pawns` };
}

export function formatScore(score: Score): string {
  if ("mate" in score) {
    if (score.mate === 0) return "#";
    return `${score.mate > 0 ? "" : "-"}M${Math.abs(score.mate)}`;
  }
  const pawns = score.cp / 100;
  // Rounds to 0.0 without a stray minus sign.
  if (Math.abs(pawns) < 0.05) return "0.0";
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}
