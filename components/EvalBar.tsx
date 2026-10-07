import type { Color } from "chess.js";
import { describeAdvantage, toCp, winningChances } from "@/lib/coach";
import type { Score } from "@/lib/engine";

interface EvalBarProps {
  /** From White's point of view. */
  score: Score | null;
  /** The side shown at the bottom, normally the player's. */
  bottom: Color;
  pending: boolean;
}

export function EvalBar({ score, bottom, pending }: EvalBarProps) {
  const white = score ? 50 + 50 * winningChances(toCp(score)) : 50;
  const adv = describeAdvantage(score);
  return (
    <div
      className={`eval-bar${bottom === "b" ? " is-flipped" : ""}${pending ? " is-pending" : ""}`}
      role="meter"
      aria-label="Evaluation"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(white)}
      aria-valuetext={adv.sentence}
      title={`${adv.sentence}. Measured in pawns: +1 is roughly an extra pawn; M3 is a forced mate in 3.`}
    >
      <div className="eval-track">
        <div className="eval-white" style={{ ["--eval" as string]: `${white}%` }} />
      </div>
      <span className="eval-label" aria-hidden>
        <span className="eval-side">{adv.side}</span>
        <span className="eval-value">{adv.value}</span>
      </span>
    </div>
  );
}
