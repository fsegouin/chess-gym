import { Chess, type Move } from "chess.js";
import { classify, negate, type Annotation } from "./coach";
import type { Analysis, Score } from "./engine";
import { moveToUci, uciToMove } from "./moves";

/** A lighter search for grading whole games: every position, one after another. */
export const GRADING_GO = "depth 15 movetime 450";

export function uciToSan(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  try {
    return new Chess(fen).move(uciToMove(uci)).san;
  } catch {
    return null;
  }
}

/**
 * The coach's grade for a move from the analyses of the positions before and after it, each scored
 * for its side to move. `mated` and `drawn` describe the position after the move.
 */
export function gradeMove(move: Move, before: Analysis, after: Analysis, mated: boolean, drawn: boolean): Annotation {
  // `after` is scored for the opponent, who is now to move.
  const afterForMover: Score = mated ? { mate: 1 } : drawn ? { cp: 0 } : negate(after.score);
  return {
    cls: mated ? "best" : classify(before.score, afterForMover, before.bestMove === moveToUci(move)),
    bestSan: uciToSan(move.before, before.bestMove),
    bestUci: before.bestMove,
    before: before.score,
    after: afterForMover,
  };
}
