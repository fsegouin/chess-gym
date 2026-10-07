import { describe, expect, it } from "vitest";
import { colorName, pieceName, sanToSpeech, squareSpeech } from "./speech";

describe("sanToSpeech", () => {
  it("reads pawn and piece moves", () => {
    expect(sanToSpeech("e4")).toBe("Pawn to e4");
    expect(sanToSpeech("Nf3")).toBe("Knight to f3");
  });

  it("reads captures and checks", () => {
    expect(sanToSpeech("Nxe5+")).toBe("Knight takes e5, check");
    expect(sanToSpeech("exd5")).toBe("Pawn e takes d5");
  });

  it("reads promotion with checkmate", () => {
    expect(sanToSpeech("e8=Q#")).toBe("Pawn to e8 promotes to Queen, checkmate");
    expect(sanToSpeech("bxa1=N")).toBe("Pawn b takes a1 promotes to Knight");
  });

  it("reads castling on either side, with check", () => {
    expect(sanToSpeech("O-O")).toBe("castles kingside");
    expect(sanToSpeech("O-O-O")).toBe("castles queenside");
    expect(sanToSpeech("O-O+")).toBe("castles kingside, check");
  });

  it("keeps file, rank or square disambiguation", () => {
    expect(sanToSpeech("Rad1")).toBe("Rook a to d1");
    expect(sanToSpeech("R1e2")).toBe("Rook 1 to e2");
    expect(sanToSpeech("Qh4xe1#")).toBe("Queen h4 takes e1, checkmate");
  });

  it("returns unrecognised text unchanged", () => {
    expect(sanToSpeech("--")).toBe("--");
  });
});

describe("pieceName and colorName", () => {
  it("names every piece type", () => {
    expect(["p", "n", "b", "r", "q", "k"].map((t) => pieceName(t as "p"))).toEqual([
      "Pawn",
      "Knight",
      "Bishop",
      "Rook",
      "Queen",
      "King",
    ]);
  });

  it("names both colours", () => {
    expect(colorName("w")).toBe("White");
    expect(colorName("b")).toBe("Black");
  });
});

describe("squareSpeech", () => {
  it("names the square and the piece on it", () => {
    expect(squareSpeech("e4", { type: "n", color: "b" })).toBe("e4, Black Knight");
  });

  it("says when the square is empty", () => {
    expect(squareSpeech("a1", null)).toBe("a1, empty");
  });
});
