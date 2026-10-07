import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { classify, negate } from "./coach";
import type { Score } from "./engine";
import { legalTargets, moveToUci, parseMove, type LegalTarget, type MoveInput } from "./moves";
import type { Puzzle, PuzzleKind } from "./training";

/** What the player is asked to find, by the kind of moment the puzzle came from. */
export const PUZZLE_PROMPT: Record<PuzzleKind, string> = {
  "missed-mate": "Find the checkmate",
  "missed-forced-mate": "Find the start of a forced mate",
  "missed-check": "Find the strong check",
  "missed-capture": "Find the move that wins material",
  slip: "Find the best move",
};

export type Verdict =
  | { correct: true; san: string; fenAfter: string; exact: boolean }
  | { correct: false; san: string; fenAfter: string };

/** A puzzle position the player moves in, with the same queries the board asks of a game. */
export class PuzzleBoard {
  private readonly chess: Chess;

  constructor(readonly puzzle: Puzzle) {
    this.chess = new Chess(puzzle.fen);
  }

  get turn(): Color {
    return this.chess.turn();
  }

  pieceAt(square: Square): { type: PieceSymbol; color: Color } | null {
    return this.chess.get(square) ?? null;
  }

  legalTargets(from: Square): LegalTarget[] {
    return legalTargets(this.chess, from);
  }

  parseMove(text: string): MoveInput | null {
    return parseMove(this.chess, text);
  }

  /** The answer played out: its SAN and the position after it. */
  preview(move: MoveInput): { san: string; fen: string } {
    const next = new Chess(this.puzzle.fen);
    const played = next.move(move);
    return { san: played.san, fen: next.fen() };
  }

  /**
   * Judges an answer. The coach's own move is always right, and so is any checkmate. Otherwise a
   * move counts when the coach grades it as good as the best one, so an equally strong alternative
   * is not marked wrong. `score` evaluates a position from the side to move.
   */
  async judge(move: MoveInput, score: (fen: string) => Promise<Score>): Promise<Verdict> {
    const next = new Chess(this.puzzle.fen);
    const played = next.move(move);
    const fenAfter = next.fen();
    const san = played.san;
    if (moveToUci(move) === this.puzzle.solution) return { correct: true, san, fenAfter, exact: true };
    if (next.isCheckmate()) return { correct: true, san, fenAfter, exact: false };
    // A missed mate in one only has mating answers.
    if (this.puzzle.kind === "missed-mate") return { correct: false, san, fenAfter };
    const after = negate(await score(fenAfter));
    const cls = classify(this.puzzle.bestScore, after, false);
    return cls === "good" ? { correct: true, san, fenAfter, exact: false } : { correct: false, san, fenAfter };
  }
}

/** How many puzzles one practice session holds at most. */
export const SESSION_SIZE = 10;
