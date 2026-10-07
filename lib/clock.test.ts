import { describe, expect, it } from "vitest";
import { clockSpeech, formatClock, getTimeControl, TIME_CONTROL_IDS, TIME_CONTROLS } from "./clock";

describe("TIME_CONTROLS", () => {
  it("names each preset minutes+increment, matching its times", () => {
    for (const c of TIME_CONTROLS) {
      expect(c.id).toBe(`${c.initialMs / 60_000}+${c.incrementMs / 1000}`);
    }
  });

  it("has unique ids", () => {
    const ids = TIME_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("files presets under the expected categories", () => {
    const category = (id: string) => getTimeControl(id)?.category;
    expect(category("1+0")).toBe("Bullet");
    expect(category("2+1")).toBe("Bullet");
    expect(category("3+2")).toBe("Blitz");
    expect(category("5+3")).toBe("Blitz");
    expect(category("10+0")).toBe("Rapid");
    expect(category("15+10")).toBe("Rapid");
    expect(category("30+20")).toBe("Classical");
  });
});

describe("getTimeControl", () => {
  it("returns the preset for a known id", () => {
    expect(getTimeControl("5+3")).toEqual({ id: "5+3", category: "Blitz", initialMs: 300_000, incrementMs: 3000 });
  });

  it("returns null for no limit and for unknown ids", () => {
    expect(getTimeControl("none")).toBeNull();
    expect(getTimeControl("7+7")).toBeNull();
    expect(getTimeControl("")).toBeNull();
  });
});

describe("TIME_CONTROL_IDS", () => {
  it("offers no limit plus every preset", () => {
    expect(TIME_CONTROL_IDS).toContain("none");
    expect([...TIME_CONTROL_IDS].sort()).toEqual(["none", ...TIME_CONTROLS.map((c) => c.id)].sort());
  });
});

describe("formatClock", () => {
  it("shows minutes and zero-padded seconds", () => {
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(600_000)).toBe("10:00");
    expect(formatClock(10_000)).toBe("0:10");
  });

  it("switches to hours past an hour", () => {
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(3_600_000)).toBe("1:00:00");
  });

  it("rounds partial seconds down", () => {
    expect(formatClock(65_999)).toBe("1:05");
  });

  it("shows tenths under ten seconds", () => {
    expect(formatClock(9_500)).toBe("0:09.5");
    expect(formatClock(9_999)).toBe("0:09.9");
    expect(formatClock(450)).toBe("0:00.4");
  });

  it("shows whole seconds under ten seconds when tenths are off", () => {
    expect(formatClock(9_500, false)).toBe("0:09");
  });

  it("clamps negative time to zero", () => {
    expect(formatClock(-500)).toBe("0:00.0");
    expect(formatClock(-500, false)).toBe("0:00");
  });
});

describe("clockSpeech", () => {
  it("speaks seconds alone under a minute", () => {
    expect(clockSpeech(45_000)).toBe("45 seconds");
  });

  it("uses the singular for one", () => {
    expect(clockSpeech(1_000)).toBe("1 second");
    expect(clockSpeech(61_000)).toBe("1 minute 1 second");
  });

  it("uses the plural for more than one", () => {
    expect(clockSpeech(125_000)).toBe("2 minutes 5 seconds");
  });

  it("rounds to the nearest second and clamps negatives", () => {
    expect(clockSpeech(4_600)).toBe("5 seconds");
    expect(clockSpeech(-3_000)).toBe("0 seconds");
  });
});
