import { expect, test } from "@playwright/test";
import { open, snapshot, startGame, waitForPlayer } from "./helpers";

type ClockInternals = { settleClock(): void; clock: { values: { w: number } }; emit(): void };

test("running out of time loses a rated game", async ({ page }) => {
  await open(page, { mode: "play", elo: 1500, timeControl: "1+0" });
  await startGame(page);
  await page.evaluate(() => window.__chess!.controller.playerMove("e2", "e4"));
  await waitForPlayer(page);
  // Leave White two seconds rather than waiting a whole minute.
  await page.evaluate(() => {
    const c = window.__chess!.controller as unknown as ClockInternals;
    c.settleClock();
    c.clock.values.w = 2000;
    c.emit();
  });
  await expect(page.locator(".status-pill")).toHaveText(/Out of time/, { timeout: 10_000 });
  const s = await snapshot(page);
  expect(s.status).toEqual({ kind: "timeout", winner: "b" });
  expect(s.ratingRecord?.change).toBeLessThan(0);
});
