import type { Color, PieceSymbol, Square } from "chess.js";

const PIECE_NAMES: Record<string, string> = {
  K: "King",
  Q: "Queen",
  R: "Rook",
  B: "Bishop",
  N: "Knight",
};

export function pieceName(type: PieceSymbol): string {
  return type === "p" ? "Pawn" : PIECE_NAMES[type.toUpperCase()];
}

export function colorName(color: Color): string {
  return color === "w" ? "White" : "Black";
}

/** Turns SAN into words a screen reader says clearly, e.g. "Nxe5+" to "Knight takes e5, check". */
export function sanToSpeech(san: string): string {
  const check = san.endsWith("#") ? ", checkmate" : san.endsWith("+") ? ", check" : "";
  const core = san.replace(/[+#]/g, "");
  if (core === "O-O") return `castles kingside${check}`;
  if (core === "O-O-O") return `castles queenside${check}`;
  const m = /^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h][1-8])(?:=([QRBN]))?$/.exec(core);
  if (!m) return san;
  const [, piece, from, capture, to, promo] = m;
  const parts = [piece ? PIECE_NAMES[piece] : "Pawn"];
  if (from) parts.push(from);
  parts.push(capture ? `takes ${to}` : `to ${to}`);
  if (promo) parts.push(`promotes to ${PIECE_NAMES[promo]}`);
  return parts.join(" ") + check;
}

export function squareSpeech(square: Square, piece: { type: PieceSymbol; color: Color } | null): string {
  return piece ? `${square}, ${colorName(piece.color)} ${pieceName(piece.type)}` : `${square}, empty`;
}
