import { afterEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "./coach";
import type { Score } from "./engine";
import type { HistoryEntry } from "./game";
import { stubBrowser } from "./test-browser";
import { phaseOf, schedule, type Puzzle } from "./training";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function entry(san: string, color: "w" | "b", from: string, to: string, annotation: Annotation | null = null): HistoryEntry {
  return { san, color, from, to, before: START, after: START, annotation } as HistoryEntry;
}

const graded = (
  cls: Annotation["cls"],
  bestSan: string,
  bestUci: string,
  before: Score = { cp: 40 },
  after: Score = { cp: -200 },
): Annotation => ({
  cls,
  bestSan,
  bestUci,
  before,
  after,
});

async function load(stored: Record<string, unknown> = {}) {
  stubBrowser(stored);
  vi.resetModules();
  return import("./training");
}

afterEach(() => vi.unstubAllGlobals());

describe("phaseOf", () => {
  it("calls the first ten moves the opening", () => {
    expect(phaseOf(START, 4)).toBe("opening");
  });

  it("calls positions with at most four minor and major pieces an endgame", () => {
    expect(phaseOf("4k3/8/8/8/8/8/4P3/R3K2R w - - 0 40", 60)).toBe("endgame");
  });

  it("calls everything else the middlegame", () => {
    expect(phaseOf(START, 30)).toBe("middlegame");
  });
});

describe("recordFinishedGame", () => {
  const history: HistoryEntry[] = [
    entry("e4", "w", "e2", "e4", graded("best", "e4", "e2e4", { cp: 30 }, { cp: 30 })),
    entry("e5", "b", "e7", "e5"),
    entry("Qh5", "w", "d1", "h5", graded("mistake", "Nf3", "g1f3", { cp: 40 }, { cp: -150 })),
    entry("Nc6", "b", "b8", "c6"),
    entry("d3", "w", "d2", "d3", graded("blunder", "Qxf7#", "h5f7", { mate: 1 }, { cp: -900 })),
  ];

  it("turns the player's teaching moments into due puzzles and keeps a game record", async () => {
    const t = await load();
    t.recordFinishedGame({ id: "g1", history, playerColor: "w", mode: "training", elo: 1200, result: 0, clockHistory: null, now: 1000 });
    const state = t.getTraining();
    expect(state.puzzles.map((p) => p.kind)).toEqual(["slip", "missed-mate"]);
    expect(state.puzzles[1]).toMatchObject({ solution: "h5f7", solutionSan: "Qxf7#", playedSan: "d3", due: 1000 });
    expect(state.games[0]).toMatchObject({ id: "g1", moves: 3, reviewed: 3, result: 0 });
    expect(state.games[0].accuracy).toBeCloseTo(1 / 3);
    expect(t.duePuzzles(state.puzzles, 1000)).toHaveLength(2);
  });

  it("records a game only once", async () => {
    const t = await load();
    const game = { id: "g1", history, playerColor: "w" as const, mode: "training" as const, elo: 1200, result: 0 as const, clockHistory: null };
    t.recordFinishedGame(game);
    t.recordFinishedGame(game);
    expect(t.getTraining().games).toHaveLength(1);
    expect(t.getTraining().puzzles).toHaveLength(2);
  });

  it("counts slips made with under 30 seconds left as time trouble", async () => {
    const t = await load();
    const clock = [
      { w: 60_000, b: 60_000 },
      { w: 58_000, b: 60_000 },
      { w: 25_000, b: 59_000 },
      { w: 24_000, b: 58_000 },
      { w: 20_000, b: 57_000 },
    ];
    t.recordFinishedGame({ id: "g1", history, playerColor: "w", mode: "training", elo: 1200, result: 0, clockHistory: clock });
    expect(t.getTraining().games[0].timeTrouble).toBe(2);
  });
});

describe("schedule", () => {
  const base = { interval: 0, ease: 2.5, reps: 0, lapses: 0, due: 0, lastResult: null } as unknown as Puzzle;
  const DAY = 24 * 60 * 60 * 1000;

  it("spaces successes out: 1 day, 3 days, then by the ease factor", () => {
    const first = schedule(base, "solved", 0);
    expect(first).toMatchObject({ reps: 1, interval: 1, due: DAY });
    const second = schedule(first, "solved", 0);
    expect(second.interval).toBe(3);
    const third = schedule(second, "solved", 0);
    expect(third.interval).toBe(Math.round(3 * second.ease));
  });

  it("resets a failure and brings it back soon", () => {
    const learnt = schedule(schedule(base, "solved", 0), "solved", 0);
    const failed = schedule(learnt, "failed", 0);
    expect(failed).toMatchObject({ reps: 0, interval: 0, lapses: 1, lastResult: "failed" });
    expect(failed.due).toBeLessThan(DAY);
    expect(failed.ease).toBeLessThan(learnt.ease);
  });
});

describe("insights", () => {
  it("aggregates mistakes, results and puzzle progress", async () => {
    const t = await load();
    const rec = (id: string, result: 0 | 0.5 | 1, accuracy: number, missedCaptures: number) => ({
      id,
      endedAt: 0,
      mode: "training",
      playerColor: "w",
      elo: 1200,
      result,
      moves: 20,
      reviewed: 20,
      counts: { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 },
      kinds: { "missed-mate": 1, "missed-forced-mate": 0, "missed-check": 0, "missed-capture": missedCaptures, slip: 0 },
      phases: { opening: 1, middlegame: missedCaptures, endgame: 0 },
      timeTrouble: 1,
      accuracy,
    });
    const i = t.insights({ puzzles: [], games: [rec("a", 1, 0.8, 2), rec("b", 0, 0.6, 3), rec("c", 0.5, 0.7, 0)] } as never, 0);
    expect(i.record).toEqual({ wins: 1, draws: 1, losses: 1 });
    expect(i.kinds["missed-capture"]).toBe(5);
    expect(i.focus[0]).toBe("missed-capture");
    expect(i.timeTrouble).toBe(3);
    expect(i.accuracyTrend).toEqual([0.7, 0.6, 0.8]);
  });
});

describe("PuzzleBoard.judge", () => {
  const puzzle = (overrides: Partial<Puzzle>): Puzzle =>
    ({
      id: "p",
      fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
      solution: "h5f7",
      solutionSan: "Qxf7#",
      playedSan: "d3",
      kind: "missed-mate",
      cls: "blunder",
      phase: "opening",
      bestScore: { mate: 1 },
      ...overrides,
    }) as Puzzle;
  const noEngine = () => Promise.reject(new Error("not needed"));

  it("accepts the coach's move", async () => {
    const { PuzzleBoard } = await import("./puzzle");
    const v = await new PuzzleBoard(puzzle({})).judge({ from: "h5", to: "f7" }, noEngine);
    expect(v).toMatchObject({ correct: true, exact: true, san: "Qxf7#" });
  });

  it("rejects a non-mating move when mate in one was there", async () => {
    const { PuzzleBoard } = await import("./puzzle");
    const v = await new PuzzleBoard(puzzle({})).judge({ from: "d2", to: "d3" }, noEngine);
    expect(v.correct).toBe(false);
  });

  it("accepts an alternative the coach rates as good, and rejects a worse one", async () => {
    const { PuzzleBoard } = await import("./puzzle");
    const board = new PuzzleBoard(puzzle({ kind: "slip", solution: "g1f3", solutionSan: "Nf3", bestScore: { cp: 300 } }));
    // The engine reports from the opponent's side after the move.
    const good = await board.judge({ from: "g1", to: "e2" }, () => Promise.resolve({ cp: -290 }));
    expect(good).toMatchObject({ correct: true, exact: false });
    const bad = await board.judge({ from: "d2", to: "d3" }, () => Promise.resolve({ cp: 150 }));
    expect(bad.correct).toBe(false);
  });
});
