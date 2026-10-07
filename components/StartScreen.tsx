"use client";

import { useEffect, useRef } from "react";
import { IconGear } from "./icons";

export interface StartChoice {
  label: string;
  value: string;
}

interface Props {
  /** What will be played, e.g. Mode: Training, Colour: White, Opponent: Stockfish 1200, Time: 5 + 3. */
  choices: StartChoice[];
  onStart: () => void;
  onCustomize: () => void;
}

/** First visit: nothing runs until the player presses Start. Settings stay reachable meanwhile. */
export function StartScreen({ choices, onStart, onCustomize }: Props) {
  const startRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Settings may already be open if it was opened while the board was loading.
    if (!document.querySelector('[role="dialog"]')) startRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="start-prompt">
      <section className="start-hero" aria-labelledby="start-title">
        <h2 id="start-title" className="start-title">
          Ready to play
        </h2>
        <dl className="start-specs">
          {choices.map((c) => (
            <div key={c.label} className="start-spec">
              <dt>{c.label}</dt>
              <dd>{c.value}</dd>
            </div>
          ))}
        </dl>
        <div className="start-actions">
          <button ref={startRef} type="button" className="btn btn-primary start-button" onClick={onStart}>
            Start game
          </button>
          <button type="button" className="start-change" onClick={onCustomize}>
            <IconGear />
            <span>Change settings</span>
          </button>
        </div>
      </section>
    </div>
  );
}
