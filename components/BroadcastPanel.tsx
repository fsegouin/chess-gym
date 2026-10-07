import { CLASS_LABEL } from "@/lib/coach";
import { yearOf, type Broadcast } from "@/lib/broadcast";
import { IconChevronLeft, IconChevronRight } from "./icons";

interface Props {
  broadcast: Broadcast;
  /** -1 before the first move, then the move just played, then `moves.length` for the end. */
  index: number;
  playing: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onRestart: () => void;
  onExit: () => void;
  onLibrary: () => void;
}

const WEAK = new Set(["inaccuracy", "mistake", "blunder"]);

function moveLabel(b: Broadcast, ply: number): string {
  return `${Math.floor(ply / 2) + 1}${b.moves[ply].color === "w" ? "." : "..."} ${b.moves[ply].san}`;
}

export function BroadcastPanel(props: Props) {
  const { broadcast: b, index, playing, onPrev, onNext, onTogglePlay, onRestart, onExit, onLibrary } = props;
  const total = b.moves.length;
  const year = yearOf(b.date);
  const header = (
    <>
      <span className="lesson-kicker">Chess TV</span>
      <p className="tv-players">
        {b.white} <span className="muted">vs</span> {b.black}
        <span className="muted">
          {" · "}
          {[b.event, year].filter(Boolean).join(", ")}
        </span>
      </p>
    </>
  );

  if (index < 0) {
    return (
      <section className="lesson-card tv-card" aria-label="Chess TV">
        {header}
        <h2 className="lesson-title">{b.title}</h2>
        <p className="lesson-text tv-text">{b.summary}</p>
        <div className="lesson-actions">
          <button type="button" className="btn btn-primary" onClick={onNext} aria-keyshortcuts="Enter">
            Watch
          </button>
          <button type="button" className="link-btn lesson-exit" onClick={onExit} aria-keyshortcuts="Escape">
            Exit
          </button>
        </div>
      </section>
    );
  }

  if (index >= total) {
    return (
      <section className="lesson-card tv-card" aria-label="Chess TV, end of the game">
        {header}
        <h2 className="lesson-title">
          {b.title}: {b.result}
        </h2>
        <ul className="tv-lessons">
          {b.lessons.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="lesson-actions">
          <button type="button" className="btn" onClick={onRestart}>
            Watch again
          </button>
          <button type="button" className="btn btn-primary" onClick={onLibrary}>
            More games
          </button>
          <button type="button" className="link-btn lesson-exit" onClick={onExit} aria-keyshortcuts="Escape">
            Exit
          </button>
        </div>
      </section>
    );
  }

  const move = b.moves[index];
  const moment = move.moment;
  const weak = WEAK.has(move.cls);
  return (
    <section
      className={`lesson-card tv-card${moment ? ` is-moment cls-${weak ? move.cls : "best"}` : ""}`}
      aria-label={moment ? "Key moment" : "Commentary"}
    >
      <span className="lesson-progress">
        {index + 1} / {total}
      </span>
      {header}
      <div className="lesson-head">
        <span className="lesson-move">{moveLabel(b, index)}</span>
        {(moment || weak) && <span className="coach-badge">{moment ? moment.title : CLASS_LABEL[move.cls]}</span>}
      </div>
      <p className="lesson-text tv-text">{moment ? moment.text : move.comment}</p>
      {moment && move.best && weak && (
        <p className="lesson-legend" aria-hidden>
          <span>
            <span className="swatch swatch-played" /> Played
          </span>
          <span>
            <span className="swatch swatch-best" /> Engine: {move.best.san}
          </span>
        </p>
      )}
      <div className="lesson-actions">
        <button type="button" className="btn" onClick={onPrev} aria-label="Previous move" aria-keyshortcuts="ArrowLeft">
          <IconChevronLeft />
        </button>
        {moment && !playing ? (
          <button type="button" className="btn btn-primary" onClick={onNext} aria-keyshortcuts="ArrowRight Enter">
            Continue
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onTogglePlay} aria-keyshortcuts="P">
            {playing ? "Pause" : "Play"}
          </button>
        )}
        {!(moment && !playing) && (
          <button type="button" className="btn" onClick={onNext} aria-label="Next move" aria-keyshortcuts="ArrowRight">
            <IconChevronRight />
          </button>
        )}
        <button type="button" className="link-btn lesson-exit" onClick={onExit} aria-keyshortcuts="Escape">
          Exit
        </button>
      </div>
    </section>
  );
}
