import { CLASS_LABEL } from "@/lib/coach";
import type { HistoryEntry } from "@/lib/game";
import { IconChevronLeft, IconChevronRight } from "./icons";

interface Props {
  entry: HistoryEntry;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onLive: () => void;
}

export function ReplayBanner({ entry, index, total, onPrev, onNext, onLive }: Props) {
  const a = entry.annotation;
  const cls = a?.cls;
  const showBest = a?.bestSan && cls && cls !== "best" && cls !== "good";
  return (
    <section className={`replay-banner${cls ? ` cls-${cls}` : ""}`} aria-label="Replay">
      <div className="replay-head">
        <span className="replay-title">
          Replaying {Math.floor(index / 2) + 1}
          {entry.color === "w" ? "." : "..."} {entry.san}
        </span>
        {cls && cls !== "good" && <span className="coach-badge">{CLASS_LABEL[cls]}</span>}
      </div>
      {showBest && (
        <p className="replay-note">
          Better was <strong className="tone-best">{a.bestSan}</strong>, shown with the green arrow.
        </p>
      )}
      <div className="replay-actions">
        <button type="button" className="btn" onClick={onPrev} disabled={index === 0} aria-label="Previous move" aria-keyshortcuts="[">
          <IconChevronLeft />
        </button>
        <span className="replay-count" aria-hidden>
          {index + 1} / {total}
        </span>
        <button type="button" className="btn" onClick={onNext} aria-label={index >= total - 1 ? "Next move, back to the game" : "Next move"} aria-keyshortcuts="]">
          <IconChevronRight />
        </button>
        <button type="button" className="btn btn-primary replay-live" onClick={onLive} aria-keyshortcuts="End">
          Back to game
        </button>
      </div>
    </section>
  );
}
