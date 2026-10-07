import { CLASS_LABEL } from "@/lib/coach";
import { PUZZLE_PROMPT } from "@/lib/puzzle";
import type { Puzzle, PuzzleResult } from "@/lib/training";

export type PuzzlePhase = "solving" | "checking" | "wrong" | "solved" | "revealed";

interface Props {
  puzzle: Puzzle | null;
  index: number;
  total: number;
  phase: PuzzlePhase;
  /** The player's latest answer, in SAN. */
  answer: string | null;
  /** True when the answer was right but not the coach's own move. */
  alternative: boolean;
  hinted: boolean;
  /** A wrong try came before the right answer. */
  missed: boolean;
  results: PuzzleResult[];
  onHint: () => void;
  onReveal: () => void;
  onNext: () => void;
  onExit: () => void;
  onOpenTraining: () => void;
}


export function PuzzlePanel(props: Props) {
  const { puzzle, index, total, phase, answer, alternative, hinted, missed, results } = props;
  const { onHint, onReveal, onNext, onExit, onOpenTraining } = props;

  if (!puzzle) {
    const solved = results.filter((r) => r === "solved").length;
    return (
      <section className={`lesson-card puzzle-card${solved > 0 ? " is-done" : ""}`} aria-label="Practice complete">
        <span className="lesson-kicker">Practice complete</span>
        <h2 className="lesson-title">
          {solved === results.length ? "Every puzzle solved first time" : `${solved} of ${results.length} solved first time`}
        </h2>
        <p className="lesson-text">
          {solved > 0 && `Solved puzzles come back in a day or more, spaced further apart each time. `}
          {solved < results.length && "The rest come back in a few minutes, until you have them."}
        </p>
        <div className="lesson-actions">
          <button type="button" className="btn btn-primary" onClick={onExit} aria-keyshortcuts="Escape">
            Back to the game
          </button>
          <button type="button" className="btn" onClick={onOpenTraining}>
            Your training
          </button>
        </div>
      </section>
    );
  }

  const done = phase === "solved" || phase === "revealed";
  const tone = phase === "solved" ? " is-solved" : phase === "wrong" || phase === "revealed" ? " is-missed" : "";

  return (
    <section className={`lesson-card puzzle-card${tone}`} aria-label="Puzzle" aria-live="polite">
      <span className="lesson-progress">
        {index + 1} / {total}
      </span>
      <span className="lesson-kicker">From one of your games</span>
      <h2 className="lesson-title">
        {phase === "solved"
          ? alternative
            ? `${answer} works too`
            : `${answer} is right`
          : phase === "revealed"
            ? `The move was ${puzzle.solutionSan}`
            : PUZZLE_PROMPT[puzzle.kind]}
      </h2>
      <p className="lesson-text">
        {phase === "solving" &&
          (hinted
            ? "That piece is the one to move. Where does it go?"
            : `In the game you played ${puzzle.playedSan} here, a ${CLASS_LABEL[puzzle.cls].toLowerCase()}.`)}
        {phase === "checking" && "Checking your move with the coach."}
        {phase === "wrong" &&
          (hinted
            ? `${answer} is not it. The highlighted piece is the one to move.`
            : `${answer} is not it. Try again, or show the answer.`)}
        {phase === "solved" &&
          (alternative
            ? `The coach's move was ${puzzle.solutionSan}, but yours keeps the advantage just as well.`
            : hinted
              ? "Found it. It comes back soon, to fix it without the hint."
              : missed
                ? "Found it on another try. It comes back soon, to get it first time."
                : "Found it. You will see this one again in a while, to make it stick.")}
        {phase === "revealed" && `It comes back in a few minutes. Look for why ${puzzle.solutionSan} works.`}
      </p>
      <div className="lesson-actions">
        {done ? (
          <button type="button" className="btn btn-primary" onClick={onNext} aria-keyshortcuts="Enter">
            {index + 1 < total ? "Next puzzle" : "Finish"}
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onHint} disabled={hinted || phase === "checking"} aria-keyshortcuts="H">
              Hint
            </button>
            <button type="button" className="btn" onClick={onReveal} disabled={phase === "checking"}>
              Show answer
            </button>
          </>
        )}
        <button type="button" className="link-btn lesson-exit" onClick={onExit} aria-keyshortcuts="Escape">
          Exit
        </button>
      </div>
      {results.length > 0 && (
        <p className="puzzle-tally muted small" aria-hidden>
          {results.filter((r) => r === "solved").length} of {results.length} solved first time so far
        </p>
      )}
    </section>
  );
}
