import { expect, test } from "@playwright/test";
import { Chess } from "chess.js";
import { open } from "./helpers";

/** A tiny broadcast fixture, so the test needs neither the generated library nor a model. */
function fixture() {
  const chess = new Chess();
  for (const san of ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]) chess.move(san);
  const moves = chess.history({ verbose: true }).map((m, ply) => ({
    san: m.san,
    color: m.color,
    from: m.from,
    to: m.to,
    before: m.before,
    after: m.after,
    evaluation: { cp: 20 },
    cls: ply === 5 ? "blunder" : "best",
    best: ply === 5 ? { san: "g6", uci: "g7g6" } : null,
    comment: `Comment for ply ${ply}.`,
    moment: ply === 5 ? { title: "The fatal knight", text: "Nf6 ignores the mate on f7." } : null,
  }));
  const broadcast = {
    slug: "scholars-mate",
    title: "Scholar's Mate",
    white: "Teacher",
    black: "Student",
    event: "Lesson",
    date: "2026.01.01",
    result: "1-0",
    summary: "The shortest lesson in chess.",
    moves,
    lessons: ["Guard f7."],
    model: "test",
    generatedAt: "2026-01-01T00:00:00Z",
  };
  const summary = { ...broadcast, plies: moves.length, moments: 1 };
  return { broadcast, summary };
}

test("Chess TV plays a game with commentary and stops on the decisive moment", async ({ page }) => {
  const { broadcast, summary } = fixture();
  await page.route("**/broadcasts/index.json", (route) => route.fulfill({ json: [summary] }));
  await page.route("**/broadcasts/scholars-mate.json", (route) => route.fulfill({ json: broadcast }));
  await open(page);

  await page.keyboard.press("w");
  const library = page.getByRole("dialog", { name: "Chess TV" });
  await library.getByRole("button", { name: /Scholar's Mate/ }).click();

  const card = page.locator(".tv-card");
  await expect(card).toContainText("The shortest lesson in chess.");
  await card.getByRole("button", { name: "Watch" }).click();
  await expect(card).toContainText("Comment for ply 0.");
  // Playback runs on its own and stops at the decisive moment, waiting for Continue.
  await expect(card.locator(".coach-badge")).toHaveText("The fatal knight", { timeout: 20_000 });
  await expect(card.getByRole("button", { name: "Continue" })).toBeVisible();
  await card.getByRole("button", { name: "Continue" }).click();
  await expect(card).toContainText("Guard f7.", { timeout: 10_000 });

  await page.keyboard.press("Escape");
  await expect(page.locator(".tv-card")).toHaveCount(0);
});
