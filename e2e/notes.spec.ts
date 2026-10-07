import { expect, test } from "@playwright/test";
import { open, type Annotation } from "./helpers";

const a = (cls: string, bestSan: string, bestUci: string, before: object, after: object): Annotation => ({
  cls,
  bestSan,
  bestUci,
  before,
  after,
});

test("shows the coach's written notes and caches them per game", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/review", async (route) => {
    calls++;
    const body = route.request().postDataJSON() as { playerColor: string; moves: unknown[] };
    expect(body.playerColor).toBe("w");
    expect(body.moves).toHaveLength(8);
    await route.fulfill({
      json: {
        headline: "A queen trip that backfired",
        story: "You started well, then 4.d3 left the queen hanging.",
        turningPoints: [{ ply: 6, title: "The hanging queen", text: "4.d3 let Black take on h5." }],
        strengths: ["A good first move."],
        focus: [{ title: "Check what is attacked", text: "Before each move, look at what your opponent threatens." }],
      },
    });
  });
  await open(page, { mode: "training" }, {
    pgn: "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nxh5",
    playerColor: "w",
    started: true,
    resigned: "w",
    annotations: [
      a("best", "e4", "e2e4", { cp: 30 }, { cp: 30 }), null,
      a("good", "Nf3", "g1f3", { cp: 35 }, { cp: 28 }), null,
      a("inaccuracy", "Nf3", "g1f3", { cp: 40 }, { cp: -10 }), null,
      a("blunder", "Qxf7#", "h5f7", { mate: 1 }, { cp: -900 }), null,
    ],
  });

  await page.getByRole("button", { name: "Coach's notes" }).click();
  const dialog = page.getByRole("dialog", { name: "Coach's notes" });
  await expect(dialog).toContainText("A queen trip that backfired");
  await expect(dialog).toContainText("4. d3");
  await dialog.getByRole("button", { name: "Show on the board" }).click();
  await expect(page.locator(".status-pill")).toHaveText("Replaying move 4");

  await page.keyboard.press("End");
  await page.getByRole("button", { name: "Coach's notes" }).click();
  await expect(page.getByRole("dialog", { name: "Coach's notes" })).toContainText("A queen trip that backfired");
  expect(calls).toBe(1);
});
