"use client";

import { useId, useState, type ChangeEvent } from "react";
import type { Color } from "chess.js";
import { guessSide, MAX_PGN_LENGTH, parsePgn, type ImportedGame } from "@/lib/pgn";
import { Dialog, Segmented } from "./ui";

interface Props {
  abandonsRatedGame: boolean;
  onImport: (game: ImportedGame, playerColor: Color) => void;
  onCancel: () => void;
}

/** The name the player last imported under, so the next game can pick their side by itself. */
const NAME_KEY = "chess3d.importName.v1";

function readName(): string | null {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Remembering the name is a convenience; without storage the side is simply chosen by hand.
  }
}

const SIDE_OPTIONS: { value: Color; label: string }[] = [
  { value: "w", label: "White" },
  { value: "b", label: "Black" },
];

const RESULT_TEXT: Record<ImportedGame["result"], string> = {
  "1-0": "White won",
  "0-1": "Black won",
  "1/2-1/2": "Draw",
  "*": "Unfinished",
};

export function ImportDialog({ abandonsRatedGame, onImport, onCancel }: Props) {
  const textId = useId();
  const [text, setText] = useState("");
  const [side, setSide] = useState<Color | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const parsed = text.trim() ? parsePgn(text) : null;
  const game = parsed?.ok ? parsed.game : null;
  // Until the player picks a side, guess it from the name they used last time.
  const chosen = side ?? (game ? (guessSide(game, readName()) ?? "w") : "w");

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_PGN_LENGTH * 4) {
      setFileError("That file is too large. Export a single game instead.");
      return;
    }
    setFileError(null);
    setSide(null);
    setText(await file.text());
  };

  const submit = () => {
    if (!game) return;
    saveName(chosen === "w" ? game.white : game.black);
    onImport(game, chosen);
  };

  return (
    <Dialog title="Review a game" onClose={onCancel}>
      <div className="new-game-form">
        <p className="muted small">
          Paste a game you played on Lichess, Chess.com or over the board, in PGN. The coach grades every one of your
          moves, then walks you through it, and your slips become puzzles.
        </p>
        <div className="field">
          <div className="field-row">
            <label className="field-label" htmlFor={textId}>
              Game (PGN)
            </label>
            <label className="link-btn import-file">
              Open a file
              <input type="file" accept=".pgn,application/x-chess-pgn,text/plain" onChange={(e) => void onFile(e)} />
            </label>
          </div>
          <textarea
            id={textId}
            className="import-text"
            rows={7}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            placeholder={'[White "you"]\n[Black "them"]\n\n1. e4 e5 2. Nf3 Nc6 ...'}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSide(null);
            }}
          />
          {/* One reserved line for the verdict on the text, so the dialog does not jump as it changes. */}
          <div className="import-status" aria-live="polite">
            {fileError && <p className="move-input-error">{fileError}</p>}
            {parsed && !parsed.ok && <p className="move-input-error">{parsed.error}</p>}
            {game && (
              <p className="import-summary">
                <span className="import-players">
                  <strong title={game.white}>{game.white}</strong>{" "}
                  <span className="muted">vs</span>{" "}
                  <strong title={game.black}>{game.black}</strong>
                </span>
                <span className="muted import-meta">
                  {Math.ceil(game.plies / 2)} moves · {RESULT_TEXT[game.result]}
                  {game.date ? ` · ${game.date.replace(/\.\?\?/g, "")}` : ""}
                </span>
              </p>
            )}
          </div>
        </div>

        <div className={`field${game ? "" : " is-disabled"}`}>
          <span className="field-label">You played</span>
          <Segmented
            label="You played"
            wide
            value={chosen}
            onChange={setSide}
            options={SIDE_OPTIONS}
            disabled={!game}
          />
          <small className="muted import-you">{game ? `You: ${chosen === "w" ? game.white : game.black}` : "\u00a0"}</small>
        </div>

        {abandonsRatedGame && (
          <p className="notice" role="note">
            Your current rated game will count as a loss if you review another one.
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!game}>
            Analyse game
          </button>
        </div>
      </div>
    </Dialog>
  );
}
