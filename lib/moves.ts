import { Chess, type PieceSymbol, type Square } from "chess.js";

export interface LegalTarget {
  to: Square;
  capture: boolean;
  promotion: boolean;
}

export type MoveInput = { from: Square; to: Square; promotion?: PieceSymbol };

export function legalTargets(chess: Chess, from: Square): LegalTarget[] {
  const seen = new Map<Square, LegalTarget>();
  for (const m of chess.moves({ square: from, verbose: true })) {
    // Promotions produce four moves to the same square; keep one target.
    seen.set(m.to, { to: m.to, capture: Boolean(m.captured), promotion: Boolean(m.promotion) });
  }
  return [...seen.values()];
}

/**
 * Reads a typed move in SAN ("Nf3", "exd5", "e8=Q") or coordinates ("g1f3", "e7e8q").
 * Returns null when it is not legal here, or when a promotion piece is missing.
 */
export function parseMove(chess: Chess, text: string): MoveInput | null {
  const input = text.trim();
  if (!input) return null;
  const coords = /^([a-h][1-8])-?([a-h][1-8])([qrbn])?$/i.exec(input);
  if (coords) {
    const [, from, to, promo] = coords;
    const move = chess
      .moves({ verbose: true })
      .find((m) => m.from === from.toLowerCase() && m.to === to.toLowerCase() && m.promotion === promo?.toLowerCase());
    return move ? { from: move.from, to: move.to, promotion: move.promotion } : null;
  }
  try {
    const move = new Chess(chess.fen()).move(input, { strict: false });
    return { from: move.from, to: move.to, promotion: move.promotion };
  } catch {
    return null;
  }
}

export function uciToMove(uci: string): MoveInput {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: (uci[4] as PieceSymbol | undefined) || undefined,
  };
}

export function moveToUci(move: MoveInput): string {
  return move.from + move.to + (move.promotion ?? "");
}
