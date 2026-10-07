import type { RatingRecord } from "@/lib/rating";

interface Props {
  result: string;
  ratingRecord: RatingRecord | null;
  canReview: boolean;
  /** Puzzles this game added to practice. */
  newPuzzles: number;
  /** The coach's progress grading an imported game. */
  progress: { done: number; total: number } | null;
  onReview: () => void;
  onNewGame: () => void;
  onPractise: () => void;
  /** Opens the written review; absent while the game has no coach grades. */
  onNotes?: () => void;
}

export function GameOverCard(props: Props) {
  const { result, ratingRecord, canReview, newPuzzles, progress, onReview, onNewGame, onPractise, onNotes } = props;
  return (
    <section className="game-over-card" aria-label="Game over">
      <h2 className="lesson-title">{result}</h2>
      {ratingRecord && (
        <p className="muted small">
          Rating {ratingRecord.rating}{" "}
          <span className={ratingRecord.change >= 0 ? "tone-best" : "tone-threat"}>
            ({ratingRecord.change >= 0 ? "+" : ""}
            {ratingRecord.change})
          </span>
        </p>
      )}
      {progress && (
        <div className="import-progress">
          <p className="muted small">The coach is going through your moves. The review opens when it is done.</p>
          <progress max={progress.total} value={progress.done} aria-label="Grading progress" />
        </div>
      )}
      {newPuzzles > 0 && (
        <p className="muted small">
          {newPuzzles === 1 ? "One moment" : `${newPuzzles} moments`} from this game {newPuzzles === 1 ? "is" : "are"} now{" "}
          {newPuzzles === 1 ? "a puzzle" : "puzzles"}.{" "}
          <button type="button" className="link-btn inline-link" onClick={onPractise}>
            Practise now
          </button>
        </p>
      )}
      <div className="lesson-actions">
        {canReview && (
          <button type="button" className="btn btn-primary" onClick={onReview}>
            Review with coach
          </button>
        )}
        {canReview && onNotes && (
          <button type="button" className="btn" onClick={onNotes}>
            Coach&apos;s notes
          </button>
        )}
        <button type="button" className={`btn${canReview ? "" : " btn-primary"}`} onClick={onNewGame}>
          New game
        </button>
      </div>
    </section>
  );
}
