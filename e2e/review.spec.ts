import { expect, test } from "@playwright/test";
import { open, type Annotation } from "./helpers";

const a = (cls: string, bestSan: string, bestUci: string, before: object, after: object): Annotation => ({
  cls,
  bestSan,
  bestUci,
  before,
  after,
});

test("the coach review stops at a slip and a missed mate, then sums up", async ({ page }) => {
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
  await page.getByRole("button", { name: "Review with coach" }).click();
  await page.getByRole("button", { name: "Start review" }).click();

  const card = page.locator(".lesson-card");
  await expect(card.locator(".coach-badge")).toHaveText("Inaccuracy");
  await page.keyboard.press("ArrowRight");
  await expect(card.locator(".coach-badge")).toHaveText("Missed checkmate");
  await expect(card).toContainText("Qxf7# was checkmate");
  await card.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("How your moves rated")).toBeVisible();
});

test("the coach review praises the moves that shaped the game", async ({ page }) => {
  await open(page, { mode: "training" }, {
    pgn: "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#",
    playerColor: "w",
    started: true,
    annotations: [
      a("best", "e4", "e2e4", { cp: 30 }, { cp: 30 }), null,
      a("good", "Nf3", "g1f3", { cp: 35 }, { cp: 30 }), null,
      a("best", "Qh5", "d1h5", { cp: 320 }, { cp: 310 }), null,
      a("best", "Qxf7#", "h5f7", { mate: 1 }, { mate: 1 }),
    ],
  });
  await page.getByRole("button", { name: "Review with coach" }).click();
  await page.getByRole("button", { name: "Start review" }).click();
  const card = page.locator(".lesson-card.is-praise");
  await expect(card.locator(".coach-badge")).toHaveText("Punished a mistake");
  await page.keyboard.press("ArrowRight");
  await expect(card.locator(".coach-badge")).toHaveText("Checkmate");
});
