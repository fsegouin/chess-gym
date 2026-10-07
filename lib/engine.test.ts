import { describe, expect, it } from "vitest";
import { opponentProfile } from "./engine";

const goValue = (go: string, key: "movetime" | "depth") => {
  const m = new RegExp(`^${key} (\\d+)$`).exec(go);
  if (!m) throw new Error(`expected "${key} N", got "${go}"`);
  return Number(m[1]);
};

describe("opponentProfile", () => {
  it("plays at full strength from 3000", () => {
    for (const elo of [3000, 3500]) {
      const p = opponentProfile(elo);
      expect(p.options.UCI_LimitStrength).toBe(false);
      expect(p.options["Skill Level"]).toBe(20);
      expect(p.go).toBe("movetime 1500");
      expect(p.randomMoveChance).toBe(0);
    }
  });

  it("uses calibrated UCI_Elo from 1320 to 2999", () => {
    for (const elo of [1320, 1800, 2999]) {
      const p = opponentProfile(elo);
      expect(p.options).toMatchObject({ UCI_LimitStrength: true, UCI_Elo: elo });
      expect(p.randomMoveChance).toBe(0);
    }
  });

  it("thinks longer as the calibrated rating rises, between 400 and 1400 ms", () => {
    const times = [1320, 1700, 2200, 2600, 2999].map((elo) => goValue(opponentProfile(elo).go, "movetime"));
    expect(times[0]).toBe(400);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(times[times.length - 1]).toBeLessThanOrEqual(1400);
  });

  it("uses Skill Level and a shallow depth below 1320", () => {
    for (const elo of [400, 800, 1319]) {
      const p = opponentProfile(elo);
      expect(p.options.UCI_LimitStrength).toBe(false);
      expect(p.options).not.toHaveProperty("UCI_Elo");
      expect(p.options["Skill Level"]).toBeGreaterThanOrEqual(0);
      expect(p.options["Skill Level"]).toBeLessThanOrEqual(4);
      const depth = goValue(p.go, "depth");
      expect(depth).toBeGreaterThanOrEqual(1);
      expect(depth).toBeLessThanOrEqual(6);
    }
  });

  it("plays its weakest at 400: skill 0, depth 1, 30% random moves", () => {
    const p = opponentProfile(400);
    expect(p.options["Skill Level"]).toBe(0);
    expect(p.go).toBe("depth 1");
    expect(p.randomMoveChance).toBeCloseTo(0.3, 10);
  });

  it("makes fewer random moves as the rating rises, none from 1320", () => {
    const chances = [400, 600, 900, 1200, 1319, 1320].map((elo) => opponentProfile(elo).randomMoveChance);
    for (let i = 1; i < chances.length; i++) expect(chances[i]).toBeLessThan(chances[i - 1]);
    expect(chances[chances.length - 1]).toBe(0);
  });

  it("never exceeds the 400 rating's random move chance below the minimum", () => {
    expect(opponentProfile(100).randomMoveChance).toBeCloseTo(0.3, 10);
  });
});
