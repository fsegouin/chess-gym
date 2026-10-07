import { describe, expect, it } from "vitest";
import { guessSide, parsePgn, resultWinner } from "./pgn";

const LICHESS = `[Event "Rated Blitz game"]
[Site "https://lichess.org/abcd1234"]
[Date "2026.10.01"]
[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 { [%clk 0:03:00] } e5 { [%clk 0:03:00] } 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# 1-0
`;

describe("parsePgn", () => {
  it("reads players, result and moves, comments and annotations included", () => {
    const r = parsePgn(LICHESS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.game).toMatchObject({ white: "alice", black: "bob", result: "1-0", date: "2026.10.01", plies: 7 });
    expect(r.game.event).toBe("Rated Blitz game");
  });

  it("reads bare movetext without headers", () => {
    const r = parsePgn("1. d4 d5 2. c4 e6");
    expect(r.ok && r.game).toMatchObject({ white: "White", black: "Black", result: "*", plies: 4 });
  });

  it("keeps only the first game of several", () => {
    const r = parsePgn(`${LICHESS}\n${LICHESS.replace("alice", "carol")}`);
    expect(r.ok && r.game.white).toBe("alice");
  });

  it("rejects empty text, illegal moves and games without moves", () => {
    expect(parsePgn("  ").ok).toBe(false);
    expect(parsePgn("1. e4 e5 2. Ke3 Ke6 3. Qxh8").ok).toBe(false);
    expect(parsePgn('[Event "x"]\n\n*').ok).toBe(false);
  });

  it("rejects games from a custom starting position", () => {
    const r = parsePgn('[SetUp "1"]\n[FEN "8/P6k/8/8/8/8/6K1/8 w - - 0 1"]\n\n1. a8=Q *');
    expect(r.ok).toBe(false);
  });

  it("rejects very long input", () => {
    expect(parsePgn("1. e4 ".repeat(30_000)).ok).toBe(false);
  });
});

describe("resultWinner and guessSide", () => {
  it("maps results to winners", () => {
    expect(resultWinner("1-0")).toBe("w");
    expect(resultWinner("0-1")).toBe("b");
    expect(resultWinner("1/2-1/2")).toBeNull();
    expect(resultWinner("*")).toBeNull();
  });

  it("guesses the side only from an unambiguous name match", () => {
    const r = parsePgn(LICHESS);
    if (!r.ok) throw new Error("parse failed");
    expect(guessSide(r.game, "Bob")).toBe("b");
    expect(guessSide(r.game, "dave")).toBeNull();
    expect(guessSide(r.game, null)).toBeNull();
  });
});
