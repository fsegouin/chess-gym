"use client";

import { useId, useState } from "react";
import { checkAccount, findUser } from "@/lib/accounts";
import { useGraderProgress } from "@/lib/grader";
import { linkAccount, SITE_NAME, SyncError, unlinkAccount, useSync, type Account, type Site, type SyncedGame } from "@/lib/sync";

interface Props {
  onReview: (game: SyncedGame) => void;
}

const SITES: Site[] = ["lichess", "chesscom"];
const SHOWN = 8;

const outcome = (g: SyncedGame) =>
  g.result === "1/2-1/2" ? "Draw" : g.result === "*" ? "Unfinished" : (g.result === "1-0") === (g.playerColor === "w") ? "Won" : "Lost";

const message = (e: unknown) => (e instanceof SyncError ? e.message : "Something went wrong. Try again later.");

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

interface SiteProps {
  site: Site;
  account: Account | null;
  onResult: (notice: string | null, error: string | null) => void;
}

/** One site: a username to link, or the linked account with its actions. */
function SiteAccount({ site, account, onResult }: SiteProps) {
  const inputId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const label = SITE_NAME[site];

  const run = async (job: () => Promise<string>) => {
    setBusy(true);
    onResult(null, null);
    try {
      onResult(await job(), null);
    } catch (e) {
      onResult(null, message(e));
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    run(async () => {
      const username = await findUser(site, name);
      linkAccount(site, username);
      setName("");
      const count = await checkAccount({ site, username, checkedAt: 0, newestAt: 0 });
      return count ? `Found ${count} recent ${label} ${count === 1 ? "game" : "games"}. The coach is grading them.` : `No finished ${label} games yet.`;
    });

  const check = () =>
    run(async () => {
      if (!account) return "";
      const count = await checkAccount(account);
      return count ? `${count} new ${label} ${count === 1 ? "game" : "games"}.` : `No new ${label} games since last time.`;
    });

  if (account) {
    return (
      <div className="online-account">
        <span>
          {label} <strong>{account.username}</strong>
        </span>
        <span className="online-account-actions">
          <button type="button" className="link-btn" onClick={() => void check()} disabled={busy}>
            {busy ? "Checking" : "Check for new games"}
          </button>
          <button type="button" className="link-btn" onClick={() => unlinkAccount(site)} aria-label={`Unlink ${label}`}>
            Unlink
          </button>
        </span>
      </div>
    );
  }
  return (
    <form
      className="online-link"
      onSubmit={(e) => {
        e.preventDefault();
        void link();
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        {label} username
      </label>
      <input
        id={inputId}
        className="online-input"
        placeholder={`${label} username`}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="btn" disabled={busy || !name.trim()} aria-label={`Link ${label}`}>
        {busy ? "Linking" : "Link"}
      </button>
    </form>
  );
}

export function OnlineGames({ onReview }: Props) {
  const { accounts, games } = useSync();
  const progress = useGraderProgress();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const waiting = games.filter((g) => !g.annotations && !g.failed).length;
  const checkedAt = Math.max(0, ...accounts.map((a) => a.checkedAt));

  return (
    <section className="settings-section">
      <h3>Your online games</h3>
      {accounts.length === 0 && (
        <p className="muted small">
          Link your Lichess or Chess.com account and your new games are fetched and graded in the background: the coach
          reviews them, and your slips become puzzles.
        </p>
      )}
      {SITES.map((site) => (
        <SiteAccount
          key={site}
          site={site}
          account={accounts.find((a) => a.site === site) ?? null}
          onResult={(n, e) => {
            setNotice(n);
            setError(e);
          }}
        />
      ))}
      {accounts.length > 0 && (
        <p className="muted small" aria-live="polite">
          {progress
            ? `Grading a game: ${progress.done} of ${progress.total} of your moves.`
            : waiting > 0
              ? `${waiting} ${waiting === 1 ? "game is" : "games are"} waiting to be graded. Grading pauses while you play.`
              : checkedAt
                ? `Checked ${ago(checkedAt)}.`
                : ""}
          {notice && ` ${notice}`}
        </p>
      )}
      {games.length > 0 && (
        <ul className="online-games">
          {games.slice(0, SHOWN).map((g) => {
            const result = outcome(g);
            const opponent = g.playerColor === "w" ? g.black : g.white;
            const grading = progress?.gameId === g.id;
            const date = new Date(g.playedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
            return (
              <li key={g.id}>
                <span className={`online-result is-${result.toLowerCase()}`}>{result}</span>
                <span className="online-game">
                  <span className="online-opponent">
                    vs {opponent}
                    {g.opponentRating ? <span className="muted"> ({g.opponentRating})</span> : null}
                  </span>
                  <span className="muted online-meta">{[SITE_NAME[g.site], g.speed, g.opening, date].filter(Boolean).join(" · ")}</span>
                </span>
                {g.annotations ? (
                  <button
                    type="button"
                    className="btn online-review"
                    onClick={() => onReview(g)}
                    aria-label={`Review your game against ${opponent}`}
                  >
                    Review
                  </button>
                ) : (
                  <span className="muted small online-state">{g.failed ? "Unreadable" : grading ? "Grading" : "Waiting"}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="move-input-error">{error}</p>}
    </section>
  );
}
