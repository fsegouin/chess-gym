"use client";

import { useEffect, useState } from "react";
import { yearOf, type BroadcastSummary } from "@/lib/broadcast";
import { Dialog } from "./ui";

interface Props {
  /** Why watching is unavailable right now, e.g. a timed game in progress; null when it can start. */
  blockedReason: string | null;
  onPick: (slug: string) => void;
  onClose: () => void;
}

type State = { kind: "loading" } | { kind: "ready"; games: BroadcastSummary[] } | { kind: "error" };

export function BroadcastLibrary({ blockedReason, onPick, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/broadcasts/index.json")
      .then((r) => (r.ok ? (r.json() as Promise<BroadcastSummary[]>) : Promise.reject(new Error(String(r.status)))))
      .then((games) => !cancelled && setState({ kind: "ready", games }))
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Dialog title="Chess TV" onClose={onClose} variant="center" className="dialog-wide">
      <p className="muted small">
        Famous games, replayed with commentary. Playback stops on the moves that decided each game.
      </p>
      {blockedReason && <p className="notice">{blockedReason}</p>}
      {state.kind === "loading" && <p className="muted small">Loading the library.</p>}
      {state.kind === "error" && <p className="move-input-error">The library could not be loaded. Try again later.</p>}
      {state.kind === "ready" && (
        <ul className="tv-library">
          {state.games.map((g) => (
            <li key={g.slug}>
              <button type="button" className="tv-entry" onClick={() => onPick(g.slug)} disabled={blockedReason !== null}>
                <span className="tv-entry-head">
                  <strong>{g.title}</strong>
                  <span className="muted">{yearOf(g.date)}</span>
                </span>
                <span className="tv-entry-players">
                  {g.white} vs {g.black} · {g.result}
                </span>
                <span className="tv-entry-summary muted">{g.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
