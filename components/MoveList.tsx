"use client";

import { useEffect, useRef } from "react";
import { CLASS_GLYPH, CLASS_LABEL } from "@/lib/coach";
import type { HistoryEntry } from "@/lib/game";

function Ply({ entry, last }: { entry: HistoryEntry | undefined; last: boolean }) {
  if (!entry) return <span className="ply is-empty" />;
  const cls = entry.annotation?.cls;
  return (
    <span
      className={`ply${cls ? ` cls-${cls}` : ""}${last ? " is-last" : ""}`}
      title={cls ? `${CLASS_LABEL[cls]}${entry.annotation?.bestSan && cls !== "best" ? `. Best was ${entry.annotation.bestSan}` : ""}` : undefined}
    >
      {entry.san}
      {cls && CLASS_GLYPH[cls] && <sup className="glyph">{CLASS_GLYPH[cls]}</sup>}
    </span>
  );
}

export function MoveList({ history }: { history: HistoryEntry[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Rows on desktop, a horizontal strip on phones: scroll whichever way overflows.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, left: el.scrollWidth, behavior: reduce ? "auto" : "smooth" });
  }, [history.length]);

  const rows: [HistoryEntry, HistoryEntry | undefined][] = [];
  for (let i = 0; i < history.length; i += 2) rows.push([history[i], history[i + 1]]);
  const last = history.length - 1;

  if (rows.length === 0) {
    return <p className="moves-empty">No moves yet. Tap a piece to begin.</p>;
  }
  return (
    <ol ref={ref} className="moves" aria-label="Moves">
      {rows.map(([w, b], i) => (
        <li key={i}>
          <span className="move-no">{i + 1}.</span>
          <Ply entry={w} last={i * 2 === last} />
          <Ply entry={b} last={i * 2 + 1 === last} />
        </li>
      ))}
    </ol>
  );
}
