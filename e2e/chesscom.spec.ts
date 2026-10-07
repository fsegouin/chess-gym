import { expect, test } from "@playwright/test";
import { open } from "./helpers";

const ARCHIVE = "https://api.chess.com/pub/player/alice/games/2026/10";
const cors = { "access-control-allow-origin": "*" };

test("links a Chess.com account and lists its graded games", async ({ page }) => {
  test.setTimeout(150_000);
  await page.route("https://api.chess.com/pub/player/alice", (route) => route.fulfill({ json: { username: "alice" }, headers: cors }));
  await page.route("https://api.chess.com/pub/player/alice/games/archives", (route) =>
    route.fulfill({ json: { archives: [ARCHIVE] }, headers: cors }),
  );
  await page.route(ARCHIVE, (route) =>
    route.fulfill({
      headers: cors,
      json: {
        games: [
          {
            url: "https://www.chess.com/game/live/123456",
            pgn: '[Event "Live Chess"]\n[White "Alice"]\n[Black "Bob"]\n[Result "0-1"]\n\n1. e4 {[%clk 0:04:58.8]} 1... e5 {[%clk 0:04:58.7]} 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nxh5 0-1',
            end_time: 1791306807,
            rules: "chess",
            time_class: "blitz",
            eco: "https://www.chess.com/openings/Italian-Game-3...Nc6",
            white: { username: "Alice", rating: 1500, result: "resigned" },
            black: { username: "Bob", rating: 1620, result: "win" },
          },
          {
            url: "https://www.chess.com/game/daily/9",
            pgn: '[Event "x"]\n\n1. e4 e5 *',
            end_time: 1791306000,
            rules: "chess960",
            time_class: "daily",
            white: { username: "Alice", result: "win" },
            black: { username: "Carol", result: "resigned" },
          },
        ],
      },
    }),
  );
  await open(page, { mode: "training" });
  await page.keyboard.press("p");
  const dialog = page.getByRole("dialog", { name: "Your training" });
  await dialog.getByPlaceholder("Chess.com username").fill("alice");
  await dialog.getByRole("button", { name: "Link Chess.com" }).click();
  await expect(dialog).toContainText("Chess.com alice");
  // The Chess960 game is left out.
  await expect(dialog.locator(".online-games li")).toHaveCount(1);
  await expect(dialog.locator(".online-games li")).toContainText("Chess.com · blitz · Italian Game");
  await expect(dialog.getByRole("button", { name: "Review your game against Bob" })).toBeVisible({ timeout: 120_000 });
});
