"use client";

import { useEffect, useRef } from "react";

interface Props {
  /** What will be played, e.g. "Training · White · Stockfish 1200 · No time limit". */
  summary: string;
  onStart: () => void;
  onCustomize: () => void;
}

/** First visit: nothing runs until the player presses Start. Settings stay reachable meanwhile. */
export function StartScreen({ summary, onStart, onCustomize }: Props) {
  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="start-prompt">
      <button ref={startRef} type="button" className="btn btn-primary start-button" onClick={onStart}>
        Start game
      </button>
      <p className="start-summary">
        <span>{summary}</span>
        <button type="button" className="link-btn" onClick={onCustomize}>
          Change
        </button>
      </p>
    </div>
  );
}
