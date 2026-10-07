import { expect, test } from "@playwright/test";
import { open, snapshot, startGame, waitForPlayer } from "./helpers";

test.beforeEach(async ({ page }) => {
  await open(page, { mode: "play", elo: 800 });
  await startGame(page);
});

test("moves with the keyboard and by typing", async ({ page }) => {
  // Keyboard focus puts the cursor on e2; Enter picks the pawn up, two steps up and Enter drops it.
  await page.focus("#board");
  for (const key of ["Enter", "ArrowUp", "ArrowUp", "Enter"]) await page.keyboard.press(key);
  await waitForPlayer(page);
  expect((await snapshot(page)).history[0].san).toBe("e4");

  await page.keyboard.press("/");
  await page.getByPlaceholder(/e4, Nf3/).fill("Nf3");
  await page.keyboard.press("Enter");
  await waitForPlayer(page);
  expect((await snapshot(page)).history.map((m) => m.san)).toContain("Nf3");
});

test("Escape shows the shortcut list", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("undo takes back the move and the reply, and the game survives a reload", async ({ page }) => {
  await page.evaluate(() => window.__chess!.controller.playerMove("e2", "e4"));
  await waitForPlayer(page);
  expect((await snapshot(page)).history).toHaveLength(2);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.__chess));
  expect((await snapshot(page)).history).toHaveLength(2);

  await page.getByRole("button", { name: "Undo" }).click();
  expect((await snapshot(page)).history).toHaveLength(0);
});
