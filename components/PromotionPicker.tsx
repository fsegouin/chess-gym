import type { Color, PieceSymbol } from "chess.js";

const CHOICES: { piece: PieceSymbol; name: string; w: string; b: string }[] = [
  { piece: "q", name: "Queen", w: "♕", b: "♛" },
  { piece: "r", name: "Rook", w: "♖", b: "♜" },
  { piece: "b", name: "Bishop", w: "♗", b: "♝" },
  { piece: "n", name: "Knight", w: "♘", b: "♞" },
];

interface Props {
  color: Color;
  onPick: (piece: PieceSymbol) => void;
  onCancel: () => void;
}

export function PromotionPicker({ color, onPick, onCancel }: Props) {
  return (
    <div className="promotion" role="dialog" aria-label="Choose a promotion piece">
      <span className="promotion-title">Promote to</span>
      <div className="promotion-options">
        {CHOICES.map((c) => (
          <button key={c.piece} type="button" onClick={() => onPick(c.piece)} aria-label={c.name} title={c.name}>
            {/* U+FE0E keeps the glyph as text instead of an emoji on iOS. */}
            <span aria-hidden>{(color === "w" ? c.w : c.b) + "︎"}</span>
          </button>
        ))}
      </div>
      <button type="button" className="link-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
