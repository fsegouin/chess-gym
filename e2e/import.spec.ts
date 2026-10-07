import { expect, test } from "@playwright/test";
import { open, snapshot } from "./helpers";

const PGN = `[Event "Casual game"]
[White "me"]
[Black "friend"]
[Result "0-1"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nxh5 0-1`;

test("imports a PGN, grades the player's moves and opens the coach review", async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, { mode: "training" });
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Review a game" });
  await dialog.getByLabel("Game (PGN)").fill(PGN);
  await expect(dialog.locator(".import-summary")).toContainText("me vs friend");
  await expect(dialog.locator(".import-summary")).toContainText("4 moves · Black won");
  await dialog.getByRole("button", { name: "Analyse game" }).click();

  await expect(page.locator(".clocks .clock").nth(1)).toContainText("me");
  await expect(page.locator(".clocks .clock-you")).toHaveText("you");
  await expect(page.locator(".status-pill")).toHaveText("Imported game. You lost", { timeout: 120_000 });
  const s = await snapshot(page);
  const mine = s.history.filter((m) => m.color === "w") as unknown as { annotation: unknown }[];
  expect(mine.every((m) => m.annotation)).toBe(true);

  await page.getByRole("button", { name: "Review with coach" }).click();
  await page.getByRole("button", { name: "Start review" }).click();
  // Losing the queen to Nxh5 after 4.d3 is a slip the coach stops on.
  await expect(page.locator(".lesson-card.is-teach").first()).toBeVisible({ timeout: 30_000 });

  // The imported game cannot be undone or played on.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("explains a PGN it cannot read", async ({ page }) => {
  await open(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Review a game" });
  await dialog.getByLabel("Game (PGN)").fill("1. e4 e5 2. Ke3 Ke6 3. Qxh8");
  await expect(dialog).toContainText("Ke3 is not a legal move at that point");
  await expect(dialog.getByRole("button", { name: "Analyse game" })).toBeDisabled();
});
