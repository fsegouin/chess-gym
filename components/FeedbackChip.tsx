import { CLASS_LABEL, type MoveClass } from "@/lib/coach";

/** Short-lived verdict on the last move; fades out on its own through CSS. */
export function FeedbackChip({ cls, san }: { cls: MoveClass; san: string }) {
  return (
    <div className={`feedback-chip cls-${cls}`} aria-live="polite">
      <span className="feedback-dot" aria-hidden />
      <span>
        {san} · {CLASS_LABEL[cls]}
      </span>
    </div>
  );
}
