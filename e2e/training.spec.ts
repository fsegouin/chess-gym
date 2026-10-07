import { expect, test } from "@playwright/test";
import { clickSquare, fenGame, open, snapshot, waitForPlayer } from "./helpers";

test("the coach stops a hung queen and lets the player try again", async ({ page }) => {
  // After 1.e4 d6 the c8 bishop covers g4, so Qg4 simply loses the queen.
  await open(page, { mode: "training" }, fenGame("rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"));
  await clickSquare(page, "d1");
  await clickSquare(page, "g4");
  await waitForPlayer(page);
  const card = page.locator(".coach-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".coach-badge")).toHaveText("Blunder");

  await card.getByRole("button", { name: "Try again" }).click();
  const s = await snapshot(page);
  expect(s.history).toHaveLength(0);
  expect(s.review).toBeNull();
});

test("a blunder kept in a finished training game becomes a puzzle", async ({ page }) => {
  await open(page, { mode: "training" }, fenGame("rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"));
  await clickSquare(page, "d1");
  await clickSquare(page, "g4");
  await waitForPlayer(page);
  await page.locator(".coach-card").getByRole("button", { name: /Keep/ }).click();
  await waitForPlayer(page);

  const resign = page.getByRole("button", { name: "Resign" });
  await resign.click();
  await page.getByRole("button", { name: "Confirm" }).click();
  const card = page.locator(".game-over-card");
  await expect(card).toContainText("One moment from this game is now a puzzle");
  await card.getByRole("button", { name: "Practise now" }).click();
  await expect(page.locator(".puzzle-card .lesson-title")).toHaveText(/Find/);
});
