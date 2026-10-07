import { afterEach, describe, expect, it, vi } from "vitest";
import { clockSpeech } from "./clock";
import { classify, formatScore } from "./coach";
import { stubBrowser } from "./test-browser";

afterEach(() => vi.unstubAllGlobals());

describe("fixed issues", () => {
  it("shows a near-zero negative evaluation as 0.0, not -0.0", () => {
    expect(formatScore({ cp: -3 })).toBe("0.0");
    expect(formatScore({ cp: 3 })).toBe("0.0");
    expect(formatScore({ cp: -5 })).toBe("-0.1");
  });

  it("grades a lost forced mate as a mistake while still clearly winning, a blunder otherwise", () => {
    expect(classify({ mate: 2 }, { cp: 600 }, false)).toBe("mistake");
    expect(classify({ mate: 2 }, { cp: 50 }, false)).toBe("blunder");
  });

  it("reads a whole minute without zero seconds", () => {
    expect(clockSpeech(60_000)).toBe("1 minute");
    expect(clockSpeech(61_000)).toBe("1 minute 1 second");
  });

  it("records the change that actually happened at the rating floor", async () => {
    stubBrowser({ "chess3d.rating.v1": { rating: 100, games: 30, wins: 0, draws: 0, losses: 30, history: [] } });
    vi.resetModules();
    const { recordResult } = await import("./rating");
    const record = recordResult(1500, 0);
    expect(record.rating).toBe(100);
    expect(record.change).toBe(0);
  });

  it("keeps the current setting when an update carries an invalid value", async () => {
    stubBrowser({ "chess3d.settings.v1": { theme: "midnight", elo: 1800 } });
    vi.resetModules();
    const { getSettings, updateSettings } = await import("./settings");
    expect(getSettings().theme).toBe("midnight");
    updateSettings({ theme: "neon" as never, elo: Number.NaN });
    expect(getSettings().theme).toBe("midnight");
    expect(getSettings().elo).toBe(1800);
  });
});
