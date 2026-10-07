import { expect, test } from "@playwright/test";
import { open, snapshot, waitForPlayer } from "./helpers";

test("a fresh visit waits for Start before anything runs", async ({ page }) => {
  await open(page, { timeControl: "5+3" });
  await expect(page.getByRole("heading", { name: "Ready to play" })).toBeVisible();
  await page.waitForTimeout(1500);
  const s = await snapshot(page);
  expect(s.started).toBe(false);
  expect(s.clock.running).toBeNull();
  expect(s.history).toHaveLength(0);
  await expect(page.locator(".clock-time").first()).toHaveText("5:00");
});

test("settings chosen before Start shape the game", async ({ page }) => {
  await open(page);
  await page.locator(".start-change").click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("radio", { name: "Black" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".start-specs")).toContainText("Black");
  await page.locator(".start-button").click();
  await waitForPlayer(page);
  const s = await snapshot(page);
  expect(s.started).toBe(true);
  expect(s.playerColor).toBe("b");
  expect(s.history.length).toBeGreaterThanOrEqual(1);
  expect(s.history[0].color).toBe("w");
});
