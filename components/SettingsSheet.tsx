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
import { useState } from "react";
import { PROVISIONAL_GAMES, resetRating, useRating } from "@/lib/rating";
import { THEME_CHOICES, THEMES } from "@/lib/themes";
import { TimeControlSelect } from "./TimeControlSelect";
import { Dialog, rovingKeyDown, Segmented, Toggle } from "./ui";

interface Props {
  settings: Settings;
  backend: string | null;
  onClose: () => void;
}

function RatingSection() {
  const r = useRating();
  const [confirming, setConfirming] = useState(false);
  const provisional = r.games < PROVISIONAL_GAMES;
  return (
    <section className="settings-section">
      <h3>Your rating</h3>
      <div className="rating-summary">
        <span className="rating-value">
          {r.rating}
          {provisional && <span className="rating-provisional">?</span>}
        </span>
        <span className="muted small">
          {r.games} rated {r.games === 1 ? "game" : "games"} · {r.wins} won · {r.draws} drawn · {r.losses} lost
          {provisional && ` · provisional until ${PROVISIONAL_GAMES} games`}
        </span>
      </div>
      {r.history.length > 0 && (
        <ol className="rating-history" aria-label="Recent rated games">
          {r.history.slice(0, 5).map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <span>{h.result === 1 ? "Won" : h.result === 0 ? "Lost" : "Drew"} vs {h.opponent}</span>
              <span className={h.change >= 0 ? "tone-best" : "tone-threat"}>
                {h.change >= 0 ? "+" : ""}
                {h.change}
              </span>
              <span className="muted">{h.rating}</span>
            </li>
          ))}
        </ol>
      )}
      <small className="muted">
        Games in Play mode count, against the engine strength above, unless you undo, ask for a hint or
        change the strength mid-game. Your rating is stored on this device only.
      </small>
      <div>
        {confirming ? (
          <span className="confirm-row">
            <button type="button" className="btn btn-danger" onClick={() => (resetRating(), setConfirming(false))}>
              Reset to 1200
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirming(true)} disabled={r.games === 0}>
            Reset rating
          </button>
        )}
      </div>
    </section>
  );
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
            disabled={s.mode === "play"}
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
          description="Shows who is ahead, in pawns (M3 is mate in 3), in training mode"
          checked={s.showEvalBar}
          onChange={(showEvalBar) => updateSettings({ showEvalBar })}
        />
      </section>

      <section className="settings-section">
        <h3>Clock</h3>
        <TimeControlSelect value={s.timeControl} onChange={(timeControl) => updateSettings({ timeControl })} />
        <small className="muted">Applies from the next game.</small>
      </section>

      <RatingSection />

      <section className="settings-section">
        <h3>Board</h3>
        <div className="themes" role="radiogroup" aria-label="Theme" onKeyDown={rovingKeyDown}>
          {THEME_CHOICES.map((id) => {
            // Auto previews its light and dark boards side by side.
            const [a, b] = id === "auto" ? [THEMES.porcelain, THEMES.midnight] : [THEMES[id], THEMES[id]];
            return (
              <button
                type="button"
                key={id}
                role="radio"
                aria-checked={s.theme === id}
                tabIndex={s.theme === id ? 0 : -1}
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
