import { expect, test, type Page } from "@playwright/test";
import { clickSquare } from "./helpers";

const SCHOLAR = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";

const puzzle = (id: string, fen: string, solution: string, solutionSan: string, kind = "missed-mate") => ({
  id,
  fen,
  solution,
  solutionSan,
  playedSan: "d3",
  kind,
  cls: "blunder",
  phase: "opening",
  bestScore: { mate: 1 },
  createdAt: 0,
  due: 0,
  interval: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  lastResult: null,
});

async function seed(page: Page, puzzles: object[]) {
  await page.goto("/icon.svg");
  await page.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem("chess3d.settings.v1", JSON.stringify({ sound: false }));
    localStorage.setItem("chess3d.training.v1", JSON.stringify({ puzzles: p, games: [] }));
  }, puzzles);
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.__chess));
}

const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("chess3d.training.v1") ?? "{}") as { puzzles: { id: string; reps: number; lapses: number; due: number }[] });

test("practises a due puzzle from the training dialog and schedules it", async ({ page }) => {
  await seed(page, [puzzle("a-6", SCHOLAR, "h5f7", "Qxf7#")]);
  const button = page.getByRole("button", { name: "Your training, 1 puzzle due" });
  await expect(button).toBeVisible();
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Your training" });
  await dialog.getByRole("button", { name: "Practise 1 puzzle" }).click();

  const card = page.locator(".puzzle-card");
  await expect(card.locator(".lesson-title")).toHaveText("Find the checkmate");
  await expect(page.locator(".status-pill")).toHaveText("White to play");

  await clickSquare(page, "h5");
  await clickSquare(page, "f7");
  await expect(card.locator(".lesson-title")).toHaveText("Qxf7# is right");
  const after = await stored(page);
  expect(after.puzzles[0]).toMatchObject({ reps: 1, lapses: 0 });
  expect(after.puzzles[0].due).toBeGreaterThan(Date.now() + 20 * 60 * 60 * 1000);

  await card.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("Every puzzle solved first time")).toBeVisible();
  await page.getByRole("button", { name: "Back to the game" }).click();
  await expect(page.locator(".puzzle-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Your training", exact: true })).toBeVisible();
});

test("a wrong answer can be retried, and showing the answer counts as a miss", async ({ page }) => {
  await seed(page, [puzzle("a-6", SCHOLAR, "h5f7", "Qxf7#")]);
  await page.keyboard.press("p");
  await page.getByRole("button", { name: "Practise 1 puzzle" }).click();

  await page.keyboard.press("/");
  await page.getByPlaceholder(/e4, Nf3/).fill("d3");
  await page.keyboard.press("Enter");
  const card = page.locator(".puzzle-card");
  await expect(card).toContainText("d3 is not it");

  await page.keyboard.press("h");
  await expect(card).toContainText("is the one to move");
  await card.getByRole("button", { name: "Show answer" }).click();
  await expect(card.locator(".lesson-title")).toHaveText("The move was Qxf7#");
  const after = await stored(page);
  expect(after.puzzles[0]).toMatchObject({ reps: 0, lapses: 1 });

  await page.keyboard.press("Escape");
  await expect(page.locator(".puzzle-card")).toHaveCount(0);
});
