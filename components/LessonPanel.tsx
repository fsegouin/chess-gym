import { CLASS_LABEL, type MoveClass } from "@/lib/coach";
import type { HistoryEntry } from "@/lib/game";
import type { Lesson, LessonStep } from "@/lib/lesson";
import { IconChevronLeft, IconChevronRight } from "./icons";

interface Props {
  lesson: Lesson;
  step: LessonStep;
  index: number;
  history: HistoryEntry[];
  playing: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onRestart: () => void;
  onExit: () => void;
  onNewGame: () => void;
}

const SUMMARY_ORDER: MoveClass[] = ["best", "good", "inaccuracy", "mistake", "blunder"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function introText(points: number, praise: number): string {
  const stops = [
    points > 0 && plural(points, "moment where you could have done better", "moments where you could have done better"),
    praise > 0 && plural(praise, "move that shaped the game", "moves that shaped the game"),
  ].filter(Boolean);
  if (stops.length === 0) {
    return "Nothing stands out to correct or celebrate. I'll still replay the game so you can watch it back.";
  }
  const plan = `I'll replay it move by move and stop at ${stops.join(", and at ")}.`;
  // Both kinds of stop make a long sentence; the Next button speaks for itself then.
  return stops.length > 1 ? plan : `${plan} Press Next at each stop to carry on.`;
}

function moveLabel(history: HistoryEntry[], ply: number): string {
  const entry = history[ply];
  return `${Math.floor(ply / 2) + 1}${entry.color === "w" ? "." : "..."} ${entry.san}`;
}

export function LessonPanel(props: Props) {
  const { lesson, step, index, history, playing, onPrev, onNext, onTogglePlay, onRestart, onExit, onNewGame } = props;
  const total = lesson.steps.length;

  const controls = (primary: "next" | "play") => (
    <div className="lesson-actions">
      <button type="button" className="btn" onClick={onPrev} disabled={index === 0} aria-label="Previous" aria-keyshortcuts="ArrowLeft">
        <IconChevronLeft />
      </button>
      {primary === "play" ? (
        <button type="button" className="btn btn-primary" onClick={onTogglePlay} aria-keyshortcuts="P">
          {playing ? "Pause" : "Play"}
        </button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={onNext} aria-keyshortcuts="ArrowRight Enter">
          Next
        </button>
      )}
      {/* At a stop the Next button already steps forward; a second Next would only repeat it. */}
      {primary === "play" && (
        <button type="button" className="btn" onClick={onNext} aria-label="Next" aria-keyshortcuts="ArrowRight">
          <IconChevronRight />
        </button>
      )}
      <button type="button" className="link-btn lesson-exit" onClick={onExit} aria-keyshortcuts="Escape">
        Exit
      </button>
    </div>
  );

  if (step.kind === "intro") {
    return (
      <section className="lesson-card" aria-label="Coach review">
        <span className="lesson-kicker">Coach review</span>
        <h2 className="lesson-title">Let&apos;s go through your game</h2>
        <p className="lesson-text">{introText(lesson.points, lesson.praise)}</p>
        <div className="lesson-actions">
          <button type="button" className="btn btn-primary" onClick={onNext} aria-keyshortcuts="Enter">
            Start review
          </button>
          <button type="button" className="link-btn lesson-exit" onClick={onExit}>
            Exit
          </button>
        </div>
      </section>
    );
  }

  if (step.kind === "summary") {
    return (
      <section className="lesson-card" aria-label="Review summary">
        <span className="lesson-kicker">Review complete</span>
        <h2 className="lesson-title">How your moves rated</h2>
        <dl className="lesson-summary">
          {SUMMARY_ORDER.map((cls) => (
            <div key={cls} className={`lesson-stat cls-${cls}`}>
              <dt>{cls === "best" ? "Best" : cls === "good" ? "Good" : CLASS_LABEL[cls].replace(/y$/, "ie") + "s"}</dt>
              <dd>{lesson.counts[cls]}</dd>
            </div>
          ))}
        </dl>
        {lesson.praise > 0 && (
          <p className="lesson-text">
            {plural(lesson.praise, "key move", "key moves")} shaped this game in your favour.
          </p>
        )}
        {lesson.unreviewed > 0 && (
          <p className="muted small">
            {lesson.unreviewed} of your moves were played outside training, so the coach did not grade them.
          </p>
        )}
        <div className="lesson-actions">
          <button type="button" className="btn" onClick={onRestart}>
            Watch again
          </button>
          <button type="button" className="btn btn-primary" onClick={onNewGame}>
            New game
          </button>
          <button type="button" className="link-btn lesson-exit" onClick={onExit}>
            Exit
          </button>
        </div>
      </section>
    );
  }

  if (step.kind === "teach") {
    const p = step.point;
    const praise = p.tone === "praise";
    return (
      <section
        className={`lesson-card is-teach ${praise ? "is-praise" : `cls-${p.cls}`}`}
        aria-label={praise ? "Key move" : "Teaching moment"}
        role="alert"
      >
        <div className="lesson-head">
          <span className="coach-badge">{p.label}</span>
          <span className="lesson-move">{moveLabel(history, step.ply)}</span>
        </div>
        <h2 className="lesson-title">{p.title}</h2>
        <p className="lesson-text">{p.text}</p>
        <p className="lesson-legend" aria-hidden>
          {praise ? (
            <span><span className="swatch swatch-best" /> Your move</span>
          ) : (
            <>
              <span><span className="swatch swatch-played" /> You played</span>
              <span><span className="swatch swatch-best" /> Better</span>
            </>
          )}
        </p>
        {controls("next")}
        <span className="lesson-progress" aria-hidden>{index} / {total - 1}</span>
      </section>
    );
  }

  return (
    <section className="lesson-card" aria-label="Coach review">
      <span className="lesson-kicker">Coach review</span>
      <h2 className="lesson-title">{moveLabel(history, step.ply)}</h2>
      {controls("play")}
      <span className="lesson-progress" aria-hidden>{index} / {total - 1}</span>
    </section>
  );
}
