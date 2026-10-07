"use client";

import { useId, useState } from "react";
import {
  ELO_MAX,
  ELO_MIN,
  ELO_PRESETS,
  MODE_OPTIONS,
  PLAYER_COLOR_OPTIONS,
  type GameMode,
  type PlayerColorChoice,
} from "@/lib/settings";
import { TimeControlSelect } from "./TimeControlSelect";
import { Segmented } from "./ui";

export interface GameOptions {
  mode: GameMode;
  color: PlayerColorChoice;
  elo: number;
  timeControl: string;
}

interface Props {
  initial: GameOptions;
  /** The game in progress is rated and leaving it would count as a loss. */
  abandonsRatedGame?: boolean;
  onStart: (options: GameOptions) => void;
  onCancel?: () => void;
}

export function NewGameForm({ initial, abandonsRatedGame = false, onStart, onCancel }: Props) {
  const [options, setOptions] = useState<GameOptions>(initial);
  const set = (patch: Partial<GameOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const eloId = useId();

  return (
    <div className="new-game-form">
      <div className="field">
        <span className="field-label">Mode</span>
        <Segmented label="Mode" wide value={options.mode} onChange={(mode) => set({ mode })} options={MODE_OPTIONS} />
        <small className="muted">
          {options.mode === "training"
            ? "A coach reviews every move and pauses the game when you slip. Training games are not rated."
            : "A straight game that counts towards your rating, unless you undo or ask for hints."}
        </small>
      </div>

      <div className="field">
        <span className="field-label">Play as</span>
        <Segmented
          label="Play as"
          wide
          value={options.color}
          onChange={(color) => set({ color })}
          options={PLAYER_COLOR_OPTIONS}
        />
      </div>

      <div className="field">
        <div className="field-row">
          <label className="field-label" htmlFor={eloId}>
            Opponent strength
          </label>
          <output className="elo-value" htmlFor={eloId}>
            {options.elo >= ELO_MAX ? "Max" : `${options.elo} Elo`}
          </output>
        </div>
        <input
          id={eloId}
          type="range"
          min={ELO_MIN}
          max={ELO_MAX}
          step={50}
          value={options.elo}
          aria-valuetext={options.elo >= ELO_MAX ? "Max" : `${options.elo} Elo`}
          onChange={(e) => set({ elo: Number(e.target.value) })}
        />
        <div className="chips">
          {ELO_PRESETS.map((p) => (
            <button
              type="button"
              key={p.label}
              className={`chip${options.elo === p.elo ? " is-active" : ""}`}
              onClick={() => set({ elo: p.elo })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <TimeControlSelect value={options.timeControl} onChange={(timeControl) => set({ timeControl })} />

      {abandonsRatedGame && (
        <p className="notice" role="note">
          Your current rated game will count as a loss if you start a new one.
        </p>
      )}

      <div className="dialog-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="btn btn-primary btn-start" onClick={() => onStart(options)}>
          {abandonsRatedGame ? "Resign and start" : "Start game"}
        </button>
      </div>
    </div>
  );
}
