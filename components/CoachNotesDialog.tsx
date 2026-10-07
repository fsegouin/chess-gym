"use client";

import { useEffect, useState } from "react";
import { saveReview, savedReview, type GameReview, type ReviewRequest } from "@/lib/game-review";
import { Dialog } from "./ui";

interface Props {
  gameId: string;
  request: ReviewRequest;
  onShowMove: (ply: number) => void;
  onClose: () => void;
}

type State = { kind: "loading" } | { kind: "ready"; review: GameReview } | { kind: "error"; message: string };

/** One request per game at a time: a remount or a second open joins the one already running. */
const inflight = new Map<string, Promise<GameReview>>();

function requestReview(gameId: string, request: ReviewRequest): Promise<GameReview> {
  let pending = inflight.get(gameId);
  if (!pending) {
    pending = fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (GameReview & { error?: string }) | null;
        if (!res.ok || !body || body.error) throw new Error(body?.error ?? "The coach could not write a review just now.");
        saveReview(gameId, body);
        return body;
      })
      .finally(() => inflight.delete(gameId));
    inflight.set(gameId, pending);
  }
  return pending;
}

function moveLabel(req: ReviewRequest, ply: number): string {
  return `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? "." : "..."} ${req.moves[ply]?.san ?? ""}`;
}

export function CoachNotesDialog({ gameId, request, onShowMove, onClose }: Props) {
  const [state, setState] = useState<State>(() => {
    const saved = savedReview(gameId);
    return saved ? { kind: "ready", review: saved } : { kind: "loading" };
  });
  const [attempt, setAttempt] = useState(0);
  const loading = state.kind === "loading";

  useEffect(() => {
    if (!loading) return;
    let active = true;
    requestReview(gameId, request)
      .then((review) => active && setState({ kind: "ready", review }))
      .catch((e: unknown) => {
        if (active) setState({ kind: "error", message: e instanceof Error ? e.message : "The coach could not write a review just now." });
      });
    return () => {
      active = false;
    };
    // The request is fixed for a finished game; `attempt` re-runs it after an error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, attempt, gameId]);

  return (
    <Dialog title="Coach's notes" onClose={onClose}>
      {state.kind === "loading" && (
        <div className="notes-loading" role="status">
          <span className="spinner" aria-hidden />
          <span>The coach is writing up your game. This takes about half a minute.</span>
        </div>
      )}
      {state.kind === "error" && (
        <div className="notes-error">
          <p className="move-input-error">{state.message}</p>
          <div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setState({ kind: "loading" });
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </div>
        </div>
      )}
      {state.kind === "ready" && (
        <>
          <section className="settings-section">
            <h3 className="notes-headline">{state.review.headline}</h3>
            <p className="lesson-text">{state.review.story}</p>
          </section>
          {state.review.turningPoints.length > 0 && (
            <section className="settings-section">
              <h3>Turning points</h3>
              <ol className="notes-points">
                {state.review.turningPoints.map((t, i) => (
                  <li key={`${t.ply}-${i}`}>
                    <div className="notes-point-head">
                      <span className="lesson-move">{moveLabel(request, t.ply)}</span>
                      <strong>{t.title}</strong>
                    </div>
                    <p className="lesson-text">{t.text}</p>
                    <button type="button" className="link-btn" onClick={() => onShowMove(t.ply)}>
                      Show on the board
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {state.review.strengths.length > 0 && (
            <section className="settings-section">
              <h3>What went well</h3>
              <ul className="notes-list">
                {state.review.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </section>
          )}
          {state.review.focus.length > 0 && (
            <section className="settings-section">
              <h3>What to work on</h3>
              <ul className="notes-focus">
                {state.review.focus.map((f) => (
                  <li key={f.title}>
                    <strong>{f.title}</strong>
                    <p className="lesson-text">{f.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="muted small">
            Written by an AI model from the coach&apos;s analysis of your moves. It can still be wrong about ideas; the
            move grades come from the engine.
          </p>
        </>
      )}
    </Dialog>
  );
}
