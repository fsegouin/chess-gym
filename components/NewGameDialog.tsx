"use client";

import { useState } from "react";
import { ELO_MAX, PLAYER_COLOR_OPTIONS, type PlayerColorChoice } from "@/lib/settings";
import { Dialog, Segmented } from "./ui";

interface Props {
  initial: PlayerColorChoice;
  elo: number;
  onStart: (color: PlayerColorChoice) => void;
  onCancel: () => void;
}

export function NewGameDialog({ initial, elo, onStart, onCancel }: Props) {
  const [color, setColor] = useState<PlayerColorChoice>(initial);
  return (
    <Dialog title="New game" onClose={onCancel} variant="center">
      <div className="field">
        <span className="field-label">Play as</span>
        <Segmented
          label="Play as"
          wide
          value={color}
          onChange={setColor}
          options={PLAYER_COLOR_OPTIONS}
        />
      </div>
      <p className="muted small">
        Opponent rated {elo >= ELO_MAX ? "at full strength" : `around ${elo}`}. Change it in settings.
      </p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onStart(color)}>
          Start game
        </button>
      </div>
    </Dialog>
  );
}
