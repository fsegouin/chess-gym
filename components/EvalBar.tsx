import type { Color } from "chess.js";
import { formatScore, toCp, winningChances } from "@/lib/coach";
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
  const label = score ? formatScore(score) : "0.0";
  const whiteAhead = score ? toCp(score) >= 0 : true;
  return (
    <div
      className={`eval-bar${bottom === "b" ? " is-flipped" : ""}${pending ? " is-pending" : ""}`}
      role="meter"
      aria-label="Evaluation"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(white)}
      aria-valuetext={`${label} for White`}
    >
      <div className="eval-white" style={{ ["--eval" as string]: `${white}%` }} />
      <span className={`eval-label ${whiteAhead ? "is-white" : "is-black"}`}>{label.replace(/^\+/, "")}</span>
    </div>
  );
}
