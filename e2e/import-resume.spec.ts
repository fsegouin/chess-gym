import { expect, test } from "@playwright/test";
import { open } from "./helpers";

test("grading an imported game carries on after a reload", async ({ page }) => {
  test.setTimeout(150_000);
  await open(page, { mode: "training" }, {
    pgn: '[White "me"]\n[Black "friend"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 1/2-1/2',
    playerColor: "w",
    started: true,
    annotations: [],
    imported: { white: "me", black: "friend", result: "1/2-1/2", event: null, date: null },
  });
  await expect(page.locator(".status-pill")).toHaveText("Imported game. Draw", { timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Review with coach" })).toBeVisible();
});
