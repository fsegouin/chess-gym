import { expect, type Page } from "@playwright/test";

/** The development-only test handle the app puts on `window` (see components/ChessApp.tsx). */
export interface Snapshot {
  history: { san: string; color: "w" | "b" }[];
  status: { kind: string; winner?: "w" | "b" };
  review: unknown;
  turn: "w" | "b";
  playerColor: "w" | "b";
  thinking: boolean;
  reviewing: boolean;
  started: boolean;
  arrows: unknown[];
  clock: { controlId: string; values: { w: number; b: number }; running: "w" | "b" | null };
  ratingRecord: { change: number; rating: number } | null;
}

export interface TestHook {
  controller: {
    getSnapshot(): Snapshot;
    canMove(): boolean;
    newGame(color: string, timeControl?: string): void;
    playerMove(from: string, to: string, promotion?: string): Promise<boolean>;
  };
  scene: {
    squareToClient(square: string): { x: number; y: number };
    camera: { position: { x: number; z: number } };
  };
}

declare global {
  interface Window {
    __chess?: TestHook;
  }
}

export type Annotation = { cls: string; bestSan: string; bestUci: string; before: object; after: object } | null;

export interface SavedGame {
  pgn: string;
  playerColor: "w" | "b";
  started?: boolean;
  resigned?: "w" | "b";
  annotations?: Annotation[];
  imported?: { white: string; black: string; result: string; event: string | null; date: string | null };
}

/** Opens the app with clean storage, the given settings and optionally a saved game. */
export async function open(page: Page, settings: Record<string, unknown> = {}, game?: SavedGame): Promise<void> {
  // Seed storage from a static file on the same origin: a mounted app would save its own game on
  // the way out and overwrite the seed.
  await page.goto("/icon.svg");
  await page.evaluate(
    ([s, g]) => {
      localStorage.clear();
      localStorage.setItem("chess3d.settings.v1", JSON.stringify({ sound: false, ...s }));
      if (g) localStorage.setItem("chess3d.game.v1", JSON.stringify(g));
    },
    [settings, game ?? null] as const,
  );
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__chess));
}

export const snapshot = (page: Page) => page.evaluate(() => window.__chess!.controller.getSnapshot());

export async function clickSquare(page: Page, square: string): Promise<void> {
  const p = await page.evaluate((s) => window.__chess!.scene.squareToClient(s), square);
  await page.mouse.click(p.x, p.y);
}

/** Waits until it is the player's turn (or the coach paused, or the game ended). */
export async function waitForPlayer(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const s = window.__chess?.controller.getSnapshot();
    if (!s) return false;
    return Boolean(s.review) || s.status.kind !== "playing" || (s.turn === s.playerColor && !s.thinking && !s.reviewing);
  });
}

export async function startGame(page: Page): Promise<void> {
  await page.locator(".start-button").click();
  await expect(page.locator(".start-prompt")).toHaveCount(0);
}

export const fenGame = (fen: string, playerColor: "w" | "b" = "w"): SavedGame => ({
  pgn: `[SetUp "1"]\n[FEN "${fen}"]\n\n*`,
  playerColor,
  started: true,
  annotations: [],
});
