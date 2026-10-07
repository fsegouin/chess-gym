import { afterEach, describe, expect, it, vi } from "vitest";
import { expectedScore, type RatingRecord } from "./rating";

const STORAGE_KEY = "chess3d.rating.v1";

/** A browser stand-in: `window` for the SSR guard and a Map-backed localStorage. */
function stubBrowser(stored?: unknown): Map<string, string> {
  const store = new Map<string, string>();
  if (stored !== undefined) store.set(STORAGE_KEY, typeof stored === "string" ? stored : JSON.stringify(stored));
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

/** A fresh copy of the module, since it caches the rating after the first read. */
async function loadRating() {
  vi.resetModules();
  return import("./rating");
}

const record = (at: number): RatingRecord => ({ at, opponent: 1200, result: 1, change: 10, rating: 1210 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("expectedScore", () => {
  it("is 0.5 between equal ratings", () => {
    expect(expectedScore(1500, 1500)).toBe(0.5);
  });

  it("is symmetric: both sides' expectations add up to 1", () => {
    expect(expectedScore(1350, 1720) + expectedScore(1720, 1350)).toBeCloseTo(1, 12);
  });

  it("gives a 400-point favourite about 0.909", () => {
    expect(expectedScore(1600, 1200)).toBeCloseTo(0.909, 3);
  });
});

describe("getRating", () => {
  it("starts at 1200 with no games when nothing is stored", async () => {
    stubBrowser();
    const { getRating } = await loadRating();
    expect(getRating()).toEqual({ rating: 1200, games: 0, wins: 0, draws: 0, losses: 0, history: [] });
  });

  it("returns the starting rating during server rendering", async () => {
    const { getRating } = await loadRating();
    expect(getRating().rating).toBe(1200);
  });

  it("falls back to the starting rating when storage is corrupt or unreadable", async () => {
    stubBrowser("{not json");
    expect((await loadRating()).getRating().rating).toBe(1200);

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect((await loadRating()).getRating().games).toBe(0);
  });

  it("sanitises stored values", async () => {
    stubBrowser({
      rating: 1234.6,
      games: -3,
      wins: 2.5,
      draws: "4",
      losses: 7,
      history: [record(1), { at: 2, opponent: 1300, result: 2, change: 0, rating: 1200 }, null, { rating: 1 }],
    });
    const state = (await loadRating()).getRating();
    expect(state).toMatchObject({ rating: 1235, games: 0, wins: 0, draws: 0, losses: 7 });
    expect(state.history).toEqual([record(1)]);
  });

  it("keeps stored ratings within 100..4000 and keeps at most 50 records", async () => {
    stubBrowser({ rating: 9000, history: Array.from({ length: 80 }, (_, i) => record(i)) });
    const high = (await loadRating()).getRating();
    expect(high.rating).toBe(4000);
    expect(high.history).toHaveLength(50);

    stubBrowser({ rating: 20 });
    expect((await loadRating()).getRating().rating).toBe(100);
  });
});

describe("recordResult", () => {
  it("moves 20 points for a first result against an equal opponent", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    stubBrowser();
    const { recordResult, getRating } = await loadRating();
    expect(recordResult(1200, 1)).toEqual({ at: 1_700_000_000_000, opponent: 1200, result: 1, change: 20, rating: 1220 });
    expect(getRating()).toMatchObject({ rating: 1220, games: 1, wins: 1, draws: 0, losses: 0 });
  });

  it("tallies draws and losses", async () => {
    stubBrowser();
    const { recordResult, getRating } = await loadRating();
    expect(recordResult(1200, 0.5).change).toBe(0);
    expect(recordResult(1600, 0).change).toBe(-4);
    expect(getRating()).toMatchObject({ rating: 1196, games: 2, wins: 0, draws: 1, losses: 1 });
  });

  it("uses K = 40 for the first 20 games and K = 20 after", async () => {
    stubBrowser({ rating: 1500, games: 19 });
    let rating = await loadRating();
    expect(rating.recordResult(1500, 1).change).toBe(20);
    expect(rating.recordResult(1520, 1).change).toBe(10);

    stubBrowser({ rating: 1500, games: 20 });
    rating = await loadRating();
    expect(rating.recordResult(1500, 0).change).toBe(-10);
  });

  it("never drops the rating below 100", async () => {
    stubBrowser({ rating: 100, games: 30 });
    const { recordResult, getRating } = await loadRating();
    expect(recordResult(100, 0).rating).toBe(100);
    expect(getRating().rating).toBe(100);
  });

  it("keeps the 50 most recent records, newest first", async () => {
    const old = Array.from({ length: 50 }, (_, i) => record(50 - i));
    stubBrowser({ rating: 1210, games: 50, history: old });
    const { recordResult, getRating } = await loadRating();
    const latest = recordResult(1200, 0.5);
    const { history } = getRating();
    expect(history).toHaveLength(50);
    expect(history[0]).toEqual(latest);
    expect(history[1]).toEqual(old[0]);
    expect(history[49]).toEqual(old[48]);
  });

  it("persists the result so a fresh load sees it", async () => {
    const store = stubBrowser();
    (await loadRating()).recordResult(1200, 1);
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "null")).toMatchObject({ rating: 1220, games: 1 });
    expect((await loadRating()).getRating()).toMatchObject({ rating: 1220, games: 1, wins: 1 });
  });
});

describe("resetRating", () => {
  it("returns to the starting rating and clears the stored history", async () => {
    stubBrowser({ rating: 1650, games: 40, wins: 30, history: [record(1)] });
    const { resetRating, getRating } = await loadRating();
    resetRating();
    expect(getRating()).toEqual({ rating: 1200, games: 0, wins: 0, draws: 0, losses: 0, history: [] });
    expect((await loadRating()).getRating().history).toEqual([]);
  });
});
