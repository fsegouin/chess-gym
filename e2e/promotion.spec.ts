import { expect, test } from "@playwright/test";
import { clickSquare, fenGame, open, snapshot } from "./helpers";

test("promotion picker offers the four pieces and takes a key", async ({ page }) => {
  await open(page, { mode: "play" }, fenGame("8/P6k/8/8/8/8/6K1/8 w - - 0 1"));
  await clickSquare(page, "a7");
  await clickSquare(page, "a8");
  const picker = page.getByRole("dialog", { name: /promote/i });
  await expect(picker).toBeVisible();
  for (const name of ["Queen", "Rook", "Bishop", "Knight"]) await expect(picker.getByRole("button", { name })).toBeVisible();
  await page.keyboard.press("r");
  await expect(picker).toHaveCount(0);
  expect((await snapshot(page)).history[0].san).toMatch(/^a8=R/);
});
