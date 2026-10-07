import { afterEach, describe, expect, it, vi } from "vitest";
import { lichessGame, speedOf, splitPgn } from "./sync";
import { stubBrowser } from "./test-browser";

const game = (id: string, white: string, black: string, extra = "") => `[Event "Rated blitz game"]
[Site "https://lichess.org/${id}"]
[Date "2026.10.06"]
[White "${white}"]
[Black "${black}"]
[Result "0-1"]
[GameId "${id}"]
[UTCDate "2026.10.06"]
[UTCTime "18:34:21"]
[WhiteElo "1500"]
[BlackElo "1620"]
[TimeControl "180+2"]
[Opening "Italian Game"]
${extra}
1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nxh5 0-1`;

afterEach(() => vi.unstubAllGlobals());

describe("speedOf", () => {
  it("files games by base time plus forty increments, like Lichess", () => {
    expect(speedOf("15+0")).toBe("ultrabullet");
    expect(speedOf("60+0")).toBe("bullet");
    expect(speedOf("180+2")).toBe("blitz");
    expect(speedOf("600+5")).toBe("rapid");
    expect(speedOf("1800+20")).toBe("classical");
    expect(speedOf("-")).toBe("correspondence");
  });
});

describe("lichessGame", () => {
  it("reads the player's side, opponent, result, speed and date", () => {
    const g = lichessGame(game("abcd1234", "Alice", "bob"), "alice");
    expect(g).toMatchObject({
      id: "lichess-abcd1234",
      url: "https://lichess.org/abcd1234",
      playerColor: "w",
      result: "0-1",
      speed: "blitz",
      opening: "Italian Game",
      opponentRating: 1620,
      playedAt: Date.parse("2026-10-06T18:34:21Z"),
      annotations: null,
    });
  });

  it("opens Black's games from Black's side on Lichess", () => {
    expect(lichessGame(game("abcd1234", "alice", "Bob"), "BOB")?.url).toBe("https://lichess.org/abcd1234/black");
  });

  it("skips variants, custom starting positions and games the player is not in", () => {
    expect(lichessGame(game("x1", "alice", "bob", '[Variant "Chess960"]'), "alice")).toBeNull();
    expect(lichessGame(game("x2", "carol", "bob"), "alice")).toBeNull();
  });
});

describe("splitPgn", () => {
  it("splits an export into its games", () => {
    expect(splitPgn(`${game("a1", "x", "y")}\n\n\n${game("a2", "x", "y")}\n`)).toHaveLength(2);
  });
});

describe("the sync store", () => {
  it("adds new games once, newest first, and hands the oldest ungraded one to the grader", async () => {
    stubBrowser();
    vi.resetModules();
    const s = await import("./sync");
    s.linkAccount("lichess", "alice");
    const a = s.lichessGame(game("g1", "alice", "bob"), "alice")!;
    const b = { ...s.lichessGame(game("g2", "alice", "bob"), "alice")!, playedAt: a.playedAt + 1000 };
    s.addGames("lichess", [a, b], 5);
    s.addGames("lichess", [a], 6);
    const state = s.getSync();
    expect(state.games.map((g) => g.id)).toEqual(["lichess-g2", "lichess-g1"]);
    expect(state.accounts[0]).toMatchObject({ checkedAt: 6, newestAt: b.playedAt });
    expect(s.nextUngraded(state)?.id).toBe("lichess-g1");
    s.setGrades("lichess-g1", []);
    expect(s.nextUngraded(s.getSync())?.id).toBe("lichess-g2");
  });

  it("forgets the old account's games when another is linked", async () => {
    stubBrowser();
    vi.resetModules();
    const s = await import("./sync");
    s.linkAccount("lichess", "alice");
    s.addGames("lichess", [s.lichessGame(game("g1", "alice", "bob"), "alice")!]);
    s.linkAccount("lichess", "carol");
    expect(s.getSync().games).toHaveLength(0);
  });
});
