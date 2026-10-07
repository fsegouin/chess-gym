import { expect, test } from "@playwright/test";
import { open } from "./helpers";

const GAME = `[Event "Rated blitz game"]
[Site "https://lichess.org/abcd1234"]
[Date "2026.10.06"]
[White "Alice"]
[Black "bob"]
[Result "0-1"]
[GameId "abcd1234"]
[UTCDate "2026.10.06"]
[UTCTime "18:34:21"]
[WhiteElo "1500"]
[BlackElo "1620"]
[TimeControl "180+2"]
[Opening "Italian Game"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nxh5 0-1

`;

test("links a Lichess account, grades its games in the background and reviews one", async ({ page }) => {
  test.setTimeout(150_000);
  await page.route("https://lichess.org/api/user/**", (route) => route.fulfill({ json: { id: "alice", username: "Alice" } }));
  await page.route("https://lichess.org/api/games/user/**", (route) =>
    route.fulfill({ body: GAME, headers: { "content-type": "application/x-chess-pgn", "access-control-allow-origin": "*" } }),
  );
  await open(page, { mode: "training" });

  await page.keyboard.press("p");
  const dialog = page.getByRole("dialog", { name: "Your training" });
  await dialog.getByPlaceholder("Lichess username").fill("alice");
  await dialog.getByRole("button", { name: "Link Lichess" }).click();
  await expect(dialog).toContainText("Lichess Alice");
  await expect(dialog.locator(".online-games li")).toHaveCount(1);
  await expect(dialog.locator(".online-games li")).toContainText("vs bob");
  await expect(dialog.locator(".online-games li")).toContainText("Lost");

  // The background grader finishes the game and its slip joins the puzzles.
  const review = dialog.getByRole("button", { name: "Review your game against bob" });
  await expect(review).toBeVisible({ timeout: 120_000 });
  await expect(dialog).toContainText(/\d+ due now|due now/);
  await review.click();
  await expect(page.locator(".status-pill")).toHaveText("Imported game. You lost");
  await expect(page.getByRole("button", { name: "Review with coach" })).toBeVisible();
});
