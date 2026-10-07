"use client";

import { useState } from "react";
import { ELO_MAX, PLAYER_COLOR_OPTIONS, type GameMode, type PlayerColorChoice } from "@/lib/settings";
import { TimeControlSelect } from "./TimeControlSelect";
import { Dialog, Segmented } from "./ui";

interface Props {
  initialColor: PlayerColorChoice;
  initialTimeControl: string;
  elo: number;
  mode: GameMode;
  /** The game in progress is rated and leaving it would count as a loss. */
  abandonsRatedGame: boolean;
  onStart: (color: PlayerColorChoice, timeControl: string) => void;
  onCancel: () => void;
}

export function NewGameDialog({ initialColor, initialTimeControl, elo, mode, abandonsRatedGame, onStart, onCancel }: Props) {
  const [color, setColor] = useState<PlayerColorChoice>(initialColor);
  const [timeControl, setTimeControl] = useState(initialTimeControl);
  return (
    <Dialog title="New game" onClose={onCancel} variant="center">
      <div className="field">
        <span className="field-label">Play as</span>
        <Segmented label="Play as" wide value={color} onChange={setColor} options={PLAYER_COLOR_OPTIONS} />
      </div>
      <TimeControlSelect value={timeControl} onChange={setTimeControl} />
      <p className="muted small">
        Opponent rated {elo >= ELO_MAX ? "at full strength" : `around ${elo}`}.{" "}
        {mode === "play"
          ? "This game counts towards your rating as long as you do not undo or ask for hints."
          : "Training games do not count towards your rating."}
      </p>
      {abandonsRatedGame && (
        <p className="notice" role="note">
          Your current rated game will count as a loss if you start a new one.
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onStart(color, timeControl)}>
          {abandonsRatedGame ? "Resign and start" : "Start game"}
        </button>
      </div>
    </Dialog>
  );
}
