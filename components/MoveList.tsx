"use client";

import { useEffect, useRef } from "react";
import { CLASS_GLYPH, CLASS_LABEL } from "@/lib/coach";
import type { HistoryEntry } from "@/lib/game";
import { sanToSpeech } from "@/lib/speech";

interface PlyProps {
  entry: HistoryEntry | undefined;
  index: number;
  last: boolean;
  viewed: boolean;
  onSelect: (index: number) => void;
}

function Ply({ entry, index, last, viewed, onSelect }: PlyProps) {
  if (!entry) return <span className="ply is-empty" />;
  const a = entry.annotation;
  const cls = a?.cls;
  const graded = cls && cls !== "good" ? `, ${CLASS_LABEL[cls]}` : "";
  const better = a?.bestSan && cls && cls !== "best" && cls !== "good" ? `. Best was ${a.bestSan}` : "";
  return (
    <button
      type="button"
      className={`ply${cls ? ` cls-${cls}` : ""}${last ? " is-last" : ""}${viewed ? " is-viewed" : ""}`}
      aria-current={viewed ? "step" : undefined}
      aria-label={`${entry.color === "w" ? "White" : "Black"} ${sanToSpeech(entry.san)}${graded}${better}. Replay this move`}
      title={cls ? `${CLASS_LABEL[cls]}${better}` : undefined}
      data-ply={index}
      onClick={() => onSelect(index)}
    >
      {entry.san}
      {cls && CLASS_GLYPH[cls] && (
        <sup className="glyph" aria-hidden>
          {CLASS_GLYPH[cls]}
        </sup>
      )}
    </button>
  );
}

interface MoveListProps {
  history: HistoryEntry[];
  /** Index of the ply being replayed, or null when following the live game. */
  viewed: number | null;
  onSelect: (index: number) => void;
}

export function MoveList({ history, viewed, onSelect }: MoveListProps) {
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduce ? "auto" : "smooth";
    if (viewed === null) {
      // Rows on desktop, a horizontal strip on phones: scroll whichever way overflows.
      el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth, behavior });
    } else {
      el.querySelector(`[data-ply="${viewed}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior });
    }
  }, [history.length, viewed]);

  const rows: [HistoryEntry, HistoryEntry | undefined][] = [];
  for (let i = 0; i < history.length; i += 2) rows.push([history[i], history[i + 1]]);
  const last = history.length - 1;

  if (rows.length === 0) {
    return <p className="moves-empty">No moves yet. Tap a piece, or use the arrow keys and Enter.</p>;
  }
  return (
    <ol ref={ref} className="moves" aria-label="Moves. Select one to replay it">
      {rows.map(([w, b], i) => (
        <li key={i}>
          <span className="move-no" aria-hidden>
            {i + 1}.
          </span>
          <Ply entry={w} index={i * 2} last={i * 2 === last} viewed={viewed === i * 2} onSelect={onSelect} />
          <Ply entry={b} index={i * 2 + 1} last={i * 2 + 1 === last} viewed={viewed === i * 2 + 1} onSelect={onSelect} />
        </li>
      ))}
    </ol>
  );
}
