"use client";

import { useState } from "react";
import { SESSION_SIZE } from "@/lib/puzzle";
import { insights, KIND_LABEL, PHASES, PUZZLE_KINDS, resetTraining, useTraining, type GamePhase } from "@/lib/training";
import type { SyncedGame } from "@/lib/sync";
import { OnlineGames } from "./OnlineGames";
import { Dialog } from "./ui";

interface Props {
  /** Why practice is unavailable right now, e.g. a timed game in progress; null when it can start. */
  blockedReason: string | null;
  onPractise: () => void;
  onImport: () => void;
  onWatch: () => void;
  onReviewOnline: (game: SyncedGame) => void;
  onClose: () => void;
}

const PHASE_LABEL: Record<GamePhase, string> = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };

const percent = (x: number) => `${Math.round(x * 100)}%`;

/** A small line of recent accuracy, oldest on the left. */
function Trend({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const points = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - v * (h - 4)).toFixed(1)}`);
  return (
    <svg className="training-trend" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <polyline points={points.join(" ")} />
    </svg>
  );
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="training-bars">
      {rows.map((r) => (
        <li key={r.label}>
          <span>{r.label}</span>
          <span className="training-bar" aria-hidden>
            <span style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="training-count">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function TrainingDialog({ blockedReason, onPractise, onImport, onWatch, onReviewOnline, onClose }: Props) {
  const state = useTraining();
  const [confirming, setConfirming] = useState(false);
  const i = insights(state);
  const slips = PUZZLE_KINDS.reduce((sum, k) => sum + i.kinds[k], 0);
  const trend =
    i.recentAccuracy !== null && i.previousAccuracy !== null ? i.recentAccuracy - i.previousAccuracy : null;

  const practiseLabel =
    i.puzzles.due > 0
      ? `Practise ${Math.min(i.puzzles.due, SESSION_SIZE)} ${i.puzzles.due === 1 ? "puzzle" : "puzzles"}`
      : "Practise ahead";

  return (
    <Dialog title="Your training" onClose={onClose}>
      <section className="settings-section">
        <h3>Puzzles from your games</h3>
        {i.puzzles.total === 0 ? (
          <p className="muted small">
            Play in Training mode: each missed mate, missed capture or slip the coach finds becomes a puzzle here,
            and comes back on a schedule until you have it.
          </p>
        ) : (
          <>
            <div className="training-figures">
              <div>
                <strong>{i.puzzles.due}</strong>
                <span>due now</span>
              </div>
              <div>
                <strong>{i.puzzles.mastered}</strong>
                <span>mastered</span>
              </div>
              <div>
                <strong>{i.puzzles.total}</strong>
                <span>in total</span>
              </div>
            </div>
            <div className="training-cta">
              <button
                type="button"
                className={`btn${i.puzzles.due > 0 ? " btn-primary" : ""}`}
                onClick={onPractise}
                disabled={blockedReason !== null}
              >
                {practiseLabel}
              </button>
              {blockedReason && <span className="muted small">{blockedReason}</span>}
              {!blockedReason && i.puzzles.due === 0 && (
                <span className="muted small">Nothing is due. Practising ahead still counts.</span>
              )}
            </div>
          </>
        )}
      </section>

      <OnlineGames onReview={onReviewOnline} />

      <section className="settings-section">
        <h3>Chess TV</h3>
        <p className="muted small">
          Watch famous games with commentary that explains each move and stops on the ones that decided the game.
        </p>
        <div>
          <button type="button" className="btn" onClick={onWatch} aria-keyshortcuts="W">
            Watch a classic
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>Games from elsewhere</h3>
        <p className="muted small">
          Paste a game from Lichess, Chess.com or over the board. The coach grades it and walks you through it, and
          your slips join your puzzles and patterns.
        </p>
        <div>
          <button type="button" className="btn" onClick={onImport} aria-keyshortcuts="I">
            Review a game
          </button>
        </div>
      </section>

      {i.games > 0 && (
        <section className="settings-section">
          <h3>Your patterns</h3>
          <div className="training-figures">
            <div>
              <strong>{i.games}</strong>
              <span>{i.games === 1 ? "game" : "games"}</span>
            </div>
            <div>
              <strong>
                {i.record.wins}–{i.record.draws}–{i.record.losses}
              </strong>
              <span>record</span>
            </div>
            <div>
              <strong>{i.recentAccuracy === null ? "–" : percent(i.recentAccuracy)}</strong>
              <span>accuracy</span>
              {trend !== null && Math.abs(trend) >= 0.02 && (
                <em className={trend > 0 ? "tone-best" : "tone-threat"}>
                  {trend > 0 ? "▲" : "▼"} {percent(Math.abs(trend))}
                </em>
              )}
            </div>
          </div>
          {i.accuracyTrend.length >= 2 && (
            <div className="training-trend-row">
              <Trend values={i.accuracyTrend} />
              <span className="muted small">Share of your moves the coach rated best or good, last {i.accuracyTrend.length} reviewed games</span>
            </div>
          )}

          {slips === 0 ? (
            <p className="muted small">
              {i.reviewedGames === 0
                ? "Play in Training mode so the coach can grade your moves and find your patterns."
                : "No slips found yet. Keep playing in Training mode."}
            </p>
          ) : (
            <>
              <h4 className="training-subhead">What you miss</h4>
              {i.focus.length > 0 && (
                <p className="lesson-text">
                  Most often: <strong>{KIND_LABEL[i.focus[0]].toLowerCase()}</strong>. Before each move, check every
                  {i.focus[0] === "missed-capture" ? " capture" : i.focus[0] === "slip" ? " opponent threat" : " check"} first.
                </p>
              )}
              <Bars rows={PUZZLE_KINDS.map((k) => ({ label: KIND_LABEL[k], value: i.kinds[k] }))} />
              <h4 className="training-subhead">When it happens</h4>
              <Bars rows={PHASES.map((p) => ({ label: PHASE_LABEL[p], value: i.phases[p] }))} />
              {i.timeTrouble > 0 && (
                <p className="muted small">
                  {i.timeTrouble} of these came with under 30 seconds on your clock.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {(i.games > 0 || i.puzzles.total > 0) && (
        <section className="settings-section">
          <small className="muted">Your training history is stored on this device only.</small>
          <div>
            {confirming ? (
              <span className="confirm-row">
                <button type="button" className="btn btn-danger" onClick={() => (resetTraining(), setConfirming(false))}>
                  Clear history
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirming(true)}>
                Clear training history
              </button>
            )}
          </div>
        </section>
      )}
    </Dialog>
  );
}
