import type { RatingRecord } from "@/lib/rating";

interface Props {
  result: string;
  ratingRecord: RatingRecord | null;
  canReview: boolean;
  onReview: () => void;
  onNewGame: () => void;
}

export function GameOverCard({ result, ratingRecord, canReview, onReview, onNewGame }: Props) {
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
      <div className="lesson-actions">
        {canReview && (
          <button type="button" className="btn btn-primary" onClick={onReview}>
            Review with coach
          </button>
        )}
        <button type="button" className={`btn${canReview ? "" : " btn-primary"}`} onClick={onNewGame}>
          New game
        </button>
      </div>
    </section>
  );
}
