"use client";

import { useEffect, useRef } from "react";
import type { Color, PieceSymbol } from "chess.js";
import { useFocusTrap } from "./ui";

const CHOICES: { piece: PieceSymbol; name: string; key: string; w: string; b: string }[] = [
  { piece: "q", name: "Queen", key: "Q", w: "♕", b: "♛" },
  { piece: "r", name: "Rook", key: "R", w: "♖", b: "♜" },
  { piece: "b", name: "Bishop", key: "B", w: "♗", b: "♝" },
  { piece: "n", name: "Knight", key: "N", w: "♘", b: "♞" },
];

interface Props {
  color: Color;
  onPick: (piece: PieceSymbol) => void;
  onCancel: () => void;
}

/** Q, R, B, N and Escape are handled by the global shortcuts while this is open. */
export function PromotionPicker({ color, onPick, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector("button")?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div ref={ref} className="promotion" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
      <span id="promotion-title" className="promotion-title">
        Promote to
      </span>
      <div className="promotion-options">
        {CHOICES.map((c) => (
          <button
            key={c.piece}
            type="button"
            onClick={() => onPick(c.piece)}
            aria-label={c.name}
            aria-keyshortcuts={c.key}
            title={`${c.name} (${c.key})`}
          >
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
