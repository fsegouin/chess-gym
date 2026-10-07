import { describe, expect, it } from "vitest";
import { chessComGame, openingFromUrl } from "./chesscom";

const archived = (overrides: Record<string, unknown> = {}) => ({
  url: "https://www.chess.com/game/live/123456",
  pgn: '[Event "Live Chess"]\n[White "Alice"]\n[Black "Bob"]\n[Result "0-1"]\n\n1. e4 {[%clk 0:04:58.8]} 1... e5 {[%clk 0:04:58.7]} 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nxh5 0-1',
  end_time: 1791306807,
  rules: "chess",
  time_class: "blitz",
  initial_setup: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  eco: "https://www.chess.com/openings/Italian-Game-3...Nc6",
  white: { username: "Alice", rating: 1500, result: "resigned" },
  black: { username: "Bob", rating: 1620, result: "win" },
  ...overrides,
});

describe("openingFromUrl", () => {
  it("names the opening without its move sequence", () => {
    expect(openingFromUrl("https://www.chess.com/openings/Sicilian-Defense-Najdorf-Variation-6.Bg5-e6")).toBe(
      "Sicilian Defense Najdorf Variation",
    );
    expect(openingFromUrl(undefined)).toBeNull();
  });
});

describe("chessComGame", () => {
  it("reads side, result, speed, opponent rating, clock comments and time", () => {
    expect(chessComGame(archived(), "alice")).toMatchObject({
      id: "chesscom-123456",
      site: "chesscom",
      playerColor: "w",
      result: "0-1",
      speed: "blitz",
      opening: "Italian Game",
      opponentRating: 1620,
      playedAt: 1791306807000,
      annotations: null,
    });
  });

  it("counts any ending without a winner as a draw, and daily games as correspondence", () => {
    const g = chessComGame(
      archived({ time_class: "daily", white: { username: "Alice", result: "agreed" }, black: { username: "Bob", result: "agreed" } }),
      "bob",
    );
    expect(g).toMatchObject({ result: "1/2-1/2", speed: "correspondence", playerColor: "b" });
  });

  it("skips variants, custom starting positions and other players' games", () => {
    expect(chessComGame(archived({ rules: "chess960" }), "alice")).toBeNull();
    expect(chessComGame(archived({ initial_setup: "8/8/8/8/8/8/8/K6k w - - 0 1" }), "alice")).toBeNull();
    expect(chessComGame(archived(), "carol")).toBeNull();
  });
});
