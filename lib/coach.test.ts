import { describe, expect, it } from "vitest";
import { classify, describeAdvantage, formatScore, negate, shouldPause, toCp, winningChances } from "./coach";

describe("toCp", () => {
  it("passes centipawn scores through unchanged", () => {
    expect(toCp({ cp: 42 })).toBe(42);
    expect(toCp({ cp: -310 })).toBe(-310);
  });

  it("places any mate for the mover above any realistic centipawn score", () => {
    expect(toCp({ mate: 20 })).toBeGreaterThan(5000);
  });

  it("ranks nearer mates higher than distant ones", () => {
    expect(toCp({ mate: 1 })).toBeGreaterThan(toCp({ mate: 3 }));
    expect(toCp({ mate: 3 })).toBeGreaterThan(toCp({ mate: 10 }));
  });

  it("ranks being mated sooner as worse than being mated later", () => {
    expect(toCp({ mate: -1 })).toBeLessThan(toCp({ mate: -3 }));
    expect(toCp({ mate: -20 })).toBeLessThan(-5000);
  });

  it("is antisymmetric between mating and being mated", () => {
    expect(toCp({ mate: -4 })).toBe(-toCp({ mate: 4 }));
  });
});

describe("negate", () => {
  it("flips centipawn and mate scores", () => {
    expect(negate({ cp: 120 })).toEqual({ cp: -120 });
    expect(negate({ mate: -3 })).toEqual({ mate: 3 });
  });
});

describe("winningChances", () => {
  it("is zero for an equal position", () => {
    expect(winningChances(0)).toBe(0);
  });

  it("stays within -1..1 for any input", () => {
    for (const cp of [-1e6, -5000, -1000, -1, 1, 1000, 5000, 1e6]) {
      expect(Math.abs(winningChances(cp))).toBeLessThan(1);
    }
  });

  it("is symmetric around zero", () => {
    for (const cp of [35, 150, 600]) {
      expect(winningChances(-cp)).toBeCloseTo(-winningChances(cp), 12);
    }
  });

  it("increases with the evaluation", () => {
    expect(winningChances(100)).toBeGreaterThan(winningChances(50));
    expect(winningChances(800)).toBeGreaterThan(winningChances(400));
  });

  it("treats everything beyond 1000 cp as 1000 cp", () => {
    expect(winningChances(1500)).toBe(winningChances(1000));
    expect(winningChances(-9990)).toBe(winningChances(-1000));
  });
});

describe("classify", () => {
  it("grades the engine's own choice as best regardless of the evaluation", () => {
    expect(classify({ cp: 300 }, { cp: -500 }, true)).toBe("best");
  });

  it("grades by lost winning chances: under 0.1 good, then inaccuracy, mistake, blunder", () => {
    expect(classify({ cp: 0 }, { cp: -40 }, false)).toBe("good");
    expect(classify({ cp: 0 }, { cp: -60 }, false)).toBe("inaccuracy");
    expect(classify({ cp: 0 }, { cp: -120 }, false)).toBe("mistake");
    expect(classify({ cp: 0 }, { cp: -180 }, false)).toBe("blunder");
  });

  it("forgives the same centipawn loss in an already decided position", () => {
    expect(classify({ cp: 0 }, { cp: -150 }, false)).toBe("mistake");
    expect(classify({ cp: 900 }, { cp: 750 }, false)).toBe("good");
  });

  it("grades an improvement as good", () => {
    expect(classify({ cp: -50 }, { cp: 40 }, false)).toBe("good");
  });

  it("does not penalise keeping a forced mate, even a slower one", () => {
    expect(classify({ mate: 2 }, { mate: 4 }, false)).toBe("good");
  });

  it("calls letting a forced mate slip a mistake while still clearly winning", () => {
    expect(classify({ mate: 3 }, { cp: 900 }, false)).toBe("mistake");
  });

  it("calls letting a forced mate slip a blunder when 300 cp or less remains", () => {
    expect(classify({ mate: 3 }, { cp: 300 }, false)).toBe("blunder");
    expect(classify({ mate: 2 }, { cp: 0 }, false)).toBe("blunder");
  });

  it("calls walking into a forced mate a blunder", () => {
    expect(classify({ cp: 50 }, { mate: -2 }, false)).toBe("blunder");
  });
});

describe("shouldPause", () => {
  it("pauses on errors at or above the threshold", () => {
    expect(shouldPause("mistake", "mistake")).toBe(true);
    expect(shouldPause("blunder", "mistake")).toBe(true);
    expect(shouldPause("inaccuracy", "inaccuracy")).toBe(true);
  });

  it("does not pause on errors below the threshold", () => {
    expect(shouldPause("inaccuracy", "mistake")).toBe(false);
    expect(shouldPause("mistake", "blunder")).toBe(false);
  });

  it("never pauses on best or good moves", () => {
    expect(shouldPause("best", "inaccuracy")).toBe(false);
    expect(shouldPause("good", "inaccuracy")).toBe(false);
  });
});

describe("formatScore", () => {
  it("shows centipawns as signed pawns with one decimal", () => {
    expect(formatScore({ cp: 30 })).toBe("+0.3");
    expect(formatScore({ cp: -120 })).toBe("-1.2");
    expect(formatScore({ cp: 0 })).toBe("0.0");
  });

  it("shows mates as M with a sign for the side being mated", () => {
    expect(formatScore({ mate: 3 })).toBe("M3");
    expect(formatScore({ mate: -2 })).toBe("-M2");
  });

  it("shows a delivered mate as #", () => {
    expect(formatScore({ mate: 0 })).toBe("#");
  });
});

describe("describeAdvantage", () => {
  it("says there is no evaluation yet when the score is missing", () => {
    expect(describeAdvantage(null)).toEqual({ side: "Even", value: "0.0", sentence: "No evaluation yet" });
  });

  it("calls positions under 0.15 pawns even", () => {
    expect(describeAdvantage({ cp: 10 }).side).toBe("Even");
    expect(describeAdvantage({ cp: -14 }).side).toBe("Even");
    expect(describeAdvantage({ cp: 0 }).sentence).toBe("The position is about even");
  });

  it("names the side ahead and the size of the advantage", () => {
    expect(describeAdvantage({ cp: 250 })).toEqual({
      side: "White",
      value: "+2.5",
      sentence: "White is ahead by about 2.5 pawns",
    });
    expect(describeAdvantage({ cp: -120 })).toEqual({
      side: "Black",
      value: "+1.2",
      sentence: "Black is ahead by about 1.2 pawns",
    });
  });

  it("describes forced mates for either side", () => {
    expect(describeAdvantage({ mate: 2 })).toEqual({
      side: "White",
      value: "M2",
      sentence: "White has a forced mate in 2",
    });
    expect(describeAdvantage({ mate: -3 })).toEqual({
      side: "Black",
      value: "M3",
      sentence: "Black has a forced mate in 3",
    });
  });

  it("describes a finished mate as checkmate", () => {
    expect(describeAdvantage({ mate: 0 })).toEqual({ side: "Mate", value: "#", sentence: "Checkmate" });
  });
});
