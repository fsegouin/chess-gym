"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { Color, PieceSymbol } from "chess.js";
import { useFocusTrap } from "./ui";

/* Drawn on a 64 unit grid sharing the stepped base of the app icon knight, so the set reads as one family. */
const BASE = (
  <>
    <rect x="16" y="46" width="32" height="5" rx="1.5" />
    <rect x="13" y="51" width="38" height="5" rx="2" />
  </>
);

const SHAPES: Record<"q" | "r" | "b" | "n", ReactNode> = {
  q: (
    <>
      <path d="M18 46 14 20l6.5 9.5L23 16l5 12.5L32 13l4 15.5L41 16l2.5 13.5L50 20l-4 26Z" />
      <circle cx="14" cy="18" r="2.6" />
      <circle cx="23" cy="14" r="2.6" />
      <circle cx="32" cy="10.5" r="2.6" />
      <circle cx="41" cy="14" r="2.6" />
      <circle cx="50" cy="18" r="2.6" />
      <path className="promotion-detail" d="M19 40h26" />
      {BASE}
    </>
  ),
  r: (
    <>
      <path d="M17 12h7v5h4.5v-5h7v5h4.5v-5h7v12H17Z" />
      <path d="M21 24h22l2 22H19Z" />
      <path className="promotion-detail" d="M21 24h22" />
      {BASE}
    </>
  ),
  b: (
    <>
      <circle cx="32" cy="9.5" r="3.5" />
      <path d="M32 14c8 6 11 13 9 19-1 3-4 5-9 5s-8-2-9-5c-2-6 1-13 9-19Z" />
      <path d="M24 38h16v4h-3l3 4H24l3-4h-3Z" />
      <path className="promotion-detail" d="m35 22-5.5 7" />
      {BASE}
    </>
  ),
  n: (
    <>
      <path
        transform="translate(2 .6)"
        d="M44.4 45.4Q46.6 32 40.8 21.9Q36.5 15.2 31.4 11.8L30 6.2L25 11.8Q18.5 15.2 10.6 24.2Q6.2 29.2 9.1 32Q14.2 33.7 21.4 32Q27.8 33.7 25.7 37.6Q17.8 43.2 17.8 45.4Z"
      />
      <circle className="promotion-eye" cx="25.5" cy="19.5" r="1.8" />
      {BASE}
    </>
  ),
};

const CHOICES = [
  { piece: "q", name: "Queen", key: "Q" },
  { piece: "r", name: "Rook", key: "R" },
  { piece: "b", name: "Bishop", key: "B" },
  { piece: "n", name: "Knight", key: "N" },
] as const;

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
    <div className="promotion" data-color={color}>
      <div ref={ref} className="promotion-panel" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
        <h2 id="promotion-title" className="promotion-title">
          Promote your pawn
        </h2>
        <div className="promotion-options">
          {CHOICES.map((c) => (
            <button
              key={c.piece}
              type="button"
              className="promotion-choice"
              onClick={() => onPick(c.piece)}
              aria-label={c.name}
              aria-keyshortcuts={c.key}
            >
              <svg className="promotion-piece" viewBox="6 4 52 55" aria-hidden>
                {SHAPES[c.piece]}
              </svg>
              <span className="promotion-name">{c.name}</span>
              <kbd aria-hidden>{c.key}</kbd>
            </button>
          ))}
        </div>
        <button type="button" className="promotion-cancel" onClick={onCancel} aria-keyshortcuts="Escape">
          <span>Cancel</span>
          <kbd aria-hidden>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
