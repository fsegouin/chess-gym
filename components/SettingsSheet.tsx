"use client";

import {
  ELO_MAX,
  ELO_MIN,
  ELO_PRESETS,
  MODE_OPTIONS,
  PLAYER_COLOR_OPTIONS,
  updateSettings,
  type Settings,
} from "@/lib/settings";
import { THEME_CHOICES, THEMES } from "@/lib/themes";
import { Dialog, Segmented, Toggle } from "./ui";

interface Props {
  settings: Settings;
  backend: string | null;
  onClose: () => void;
}

export function SettingsSheet({ settings, backend, onClose }: Props) {
  const s = settings;
  return (
    <Dialog title="Settings" onClose={onClose}>
      <section className="settings-section">
        <h3>Opponent</h3>
        <div className="field">
          <div className="field-row">
            <label className="field-label" htmlFor="elo">
              Strength
            </label>
            <output className="elo-value" htmlFor="elo">
              {s.elo >= ELO_MAX ? "Max" : `${s.elo} Elo`}
            </output>
          </div>
          <input
            id="elo"
            type="range"
            min={ELO_MIN}
            max={ELO_MAX}
            step={50}
            value={s.elo}
            aria-valuetext={s.elo >= ELO_MAX ? "Max" : `${s.elo} Elo`}
            onChange={(e) => updateSettings({ elo: Number(e.target.value) })}
          />
          <div className="chips">
            {ELO_PRESETS.map((p) => (
              <button
                type="button"
                key={p.label}
                className={`chip${s.elo === p.elo ? " is-active" : ""}`}
                onClick={() => updateSettings({ elo: p.elo })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <small className="muted">
            Ratings below 1320 are approximate: the engine searches shallower and sometimes plays loose moves.
          </small>
        </div>
        <div className="field">
          <span className="field-label">Play as (next game)</span>
          <Segmented
            label="Play as"
            wide
            value={s.playerColor}
            onChange={(playerColor) => updateSettings({ playerColor })}
            options={PLAYER_COLOR_OPTIONS}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3>Training</h3>
        <div className="field">
          <span className="field-label">Mode</span>
          <Segmented
            label="Mode"
            wide
            value={s.mode}
            onChange={(mode) => updateSettings({ mode })}
            options={MODE_OPTIONS}
          />
          <small className="muted">
            In training, a coach engine reviews every move you make and pauses the game when you slip.
          </small>
        </div>
        <div className={`field${s.mode === "play" ? " is-disabled" : ""}`}>
          <span className="field-label">Pause the game on</span>
          <Segmented
            label="Pause the game on"
            wide
            value={s.pauseOn}
            onChange={(pauseOn) => updateSettings({ pauseOn })}
            options={[
              { value: "inaccuracy", label: "Inaccuracies" },
              { value: "mistake", label: "Mistakes" },
              { value: "blunder", label: "Blunders" },
            ]}
          />
        </div>
        <Toggle
          label="Evaluation bar"
          description="Shows who is better, in training mode"
          checked={s.showEvalBar}
          onChange={(showEvalBar) => updateSettings({ showEvalBar })}
        />
      </section>

      <section className="settings-section">
        <h3>Board</h3>
        <div className="themes" role="radiogroup" aria-label="Theme">
          {THEME_CHOICES.map((id) => {
            // Auto previews its light and dark boards side by side.
            const [a, b] = id === "auto" ? [THEMES.porcelain, THEMES.midnight] : [THEMES[id], THEMES[id]];
            return (
              <button
                type="button"
                key={id}
                role="radio"
                aria-checked={s.theme === id}
                className={`theme-swatch${s.theme === id ? " is-active" : ""}`}
                onClick={() => updateSettings({ theme: id })}
              >
                <span className="swatch-board" aria-hidden>
                  <i style={{ background: a.board.light }} />
                  <i style={{ background: b.board.dark }} />
                  <i style={{ background: a.board.dark }} />
                  <i style={{ background: b.board.light }} />
                </span>
                <span>{id === "auto" ? "Auto" : THEMES[id].name}</span>
              </button>
            );
          })}
        </div>
        <Toggle
          label="Show legal moves"
          checked={s.showLegalMoves}
          onChange={(showLegalMoves) => updateSettings({ showLegalMoves })}
        />
        <Toggle
          label="Highlight last move"
          checked={s.showLastMove}
          onChange={(showLastMove) => updateSettings({ showLastMove })}
        />
        <Toggle label="Sound" checked={s.sound} onChange={(sound) => updateSettings({ sound })} />
        <div className="field">
          <span className="field-label">Graphics</span>
          <Segmented
            label="Graphics"
            wide
            value={s.quality}
            onChange={(quality) => updateSettings({ quality })}
            options={[
              { value: "high", label: "High quality" },
              { value: "low", label: "Battery saver" },
            ]}
          />
        </div>
      </section>

      <p className="muted small settings-foot">
        Settings and your current game are saved on this device.
        {backend && ` Rendering with ${backend}.`}
      </p>
    </Dialog>
  );
}
