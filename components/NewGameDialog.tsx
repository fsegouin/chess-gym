"use client";

import { NewGameForm, type GameOptions } from "./NewGameForm";
import { Dialog } from "./ui";

interface Props {
  initial: GameOptions;
  abandonsRatedGame: boolean;
  onStart: (options: GameOptions) => void;
  onCancel: () => void;
}

export function NewGameDialog({ initial, abandonsRatedGame, onStart, onCancel }: Props) {
  return (
    <Dialog title="New game" onClose={onCancel} variant="center">
      <NewGameForm initial={initial} abandonsRatedGame={abandonsRatedGame} onStart={onStart} onCancel={onCancel} />
    </Dialog>
  );
}
