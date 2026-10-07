import type { Color } from "chess.js";
import { CLASS_LABEL, formatScore } from "@/lib/coach";
import type { Review } from "@/lib/game";

interface Props {
  review: Review;
  moveNumber: number;
  color: Color;
  onRetry: () => void;
  onToggleBest: () => void;
  onToggleThreat: () => void;
  onKeep: () => void;
}

/** Training pause: explains what went wrong and lets the player retry before seeing the answer. */
export function CoachCard({ review, moveNumber, color, onRetry, onToggleBest, onToggleThreat, onKeep }: Props) {
  const { annotation, san, threatSan, showBest, showThreat } = review;
  const cls = annotation.cls;
  return (
    <section className={`coach-card cls-${cls}`} aria-labelledby="coach-title" role="alert">
      <header className="coach-head">
        <span className="coach-badge">{CLASS_LABEL[cls]}</span>
        <span id="coach-title" className="coach-move">
          {moveNumber}
          {color === "w" ? "." : "..."} {san}
        </span>
        <button type="button" className="link-btn coach-keep" onClick={onKeep}>
          Keep my move
        </button>
      </header>
      <p className="coach-eval">
        Your position went from <strong>{formatScore(annotation.before)}</strong> to{" "}
        <strong>{formatScore(annotation.after)}</strong>.
      </p>
      <p className="coach-text">
        {showBest && annotation.bestSan ? (
          <>
            The stronger move was <strong className="tone-best">{annotation.bestSan}</strong>.
          </>
        ) : (
          "There was a stronger move here. Can you find it?"
        )}
        {showThreat && threatSan && (
          <>
            {" "}
            After your move, the opponent answers <strong className="tone-threat">{threatSan}</strong>.
          </>
        )}
      </p>
      <div className="coach-actions">
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
        {threatSan && (
          <button type="button" className="btn" aria-pressed={showThreat} onClick={onToggleThreat}>
            <span className="swatch swatch-threat" aria-hidden />
            Threat
          </button>
        )}
        {annotation.bestSan && (
          <button type="button" className="btn" aria-pressed={showBest} onClick={onToggleBest}>
            <span className="swatch swatch-best" aria-hidden />
            Best move
          </button>
        )}
      </div>
    </section>
  );
}
