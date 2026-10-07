"use client";

import { NewGameForm, type GameOptions } from "./NewGameForm";
import { Dialog } from "./ui";

interface Props {
  initial: GameOptions;
  abandonsRatedGame: boolean;
  onStart: (options: GameOptions) => void;
  onCancel: () => void;
  /** Opens the import of a game played elsewhere instead. */
  onImport: () => void;
}

export function NewGameDialog({ initial, abandonsRatedGame, onStart, onCancel, onImport }: Props) {
  return (
    <Dialog title="New game" onClose={onCancel} variant="center">
      <p className="muted small">
        Played a game elsewhere?{" "}
        <button type="button" className="link-btn inline-link" onClick={onImport}>
          Review it with the coach
        </button>
      </p>
      <NewGameForm initial={initial} abandonsRatedGame={abandonsRatedGame} onStart={onStart} onCancel={onCancel} />
    </Dialog>
  );
}
