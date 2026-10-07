import type { Color, Square } from "chess.js";
import { describe, expect, it } from "vitest";
import type { Annotation } from "./coach";
import type { HistoryEntry } from "./game";
import { buildLesson, hasLessonData, type LessonStep } from "./lesson";

function entry(
  san: string,
  color: Color,
  annotation: Partial<Annotation> | null = null,
  from: Square = "e2",
  to: Square = "e4",
): HistoryEntry {
  return {
    san,
    color,
    from,
    to,
    before: "",
    after: "",
    annotation: annotation && {
      cls: "good",
      bestSan: null,
      bestUci: null,
      before: { cp: 0 },
      after: { cp: 0 },
      ...annotation,
    },
  };
}

const teachSteps = (steps: LessonStep[]) => steps.filter((s) => s.kind === "teach");

describe("buildLesson structure", () => {
  it("wraps an empty game in an intro and a summary", () => {
    expect(buildLesson([], "w").steps).toEqual([{ kind: "intro" }, { kind: "summary" }]);
  });

  it("replays every move in order between the intro and the summary", () => {
    const history = [entry("e4", "w"), entry("e5", "b"), entry("Nf3", "w")];
    expect(buildLesson(history, "w").steps).toEqual([
      { kind: "intro" },
      { kind: "move", ply: 0 },
      { kind: "move", ply: 1 },
      { kind: "move", ply: 2 },
      { kind: "summary" },
    ]);
  });

  it("puts a teaching stop immediately before the player's move", () => {
    const history = [
      entry("e4", "w", { cls: "best" }),
      entry("e5", "b"),
      entry("Ba6", "w", { cls: "blunder", bestSan: "Nf3", bestUci: "g1f3", before: { cp: 40 }, after: { cp: -300 } }, "f1", "a6"),
    ];
    const { steps } = buildLesson(history, "w");
    const i = steps.findIndex((s) => s.kind === "teach");
    expect(steps[i]).toMatchObject({ kind: "teach", ply: 2 });
    expect(steps[i + 1]).toEqual({ kind: "move", ply: 2 });
  });
});

describe("buildLesson teaching points", () => {
  const point = (annotation: Partial<Annotation>, san = "Nf3") => {
    const steps = buildLesson([entry(san, "w", annotation, "g1", "f3")], "w").steps;
    const teach = teachSteps(steps);
    return teach.length === 1 && teach[0].kind === "teach" ? teach[0].point : null;
  };

  it("flags a missed mate in one, even when the move was otherwise fine", () => {
    const p = point({ cls: "good", bestSan: "Qh7#", bestUci: "d3h7", before: { mate: 1 }, after: { mate: 2 } });
    expect(p).toMatchObject({ tone: "improve", label: "Missed checkmate", bestUci: "d3h7", playedUci: "g1f3" });
    expect(p?.title).toContain("Qh7#");
  });

  it("flags letting a forced mate slip", () => {
    const p = point({ cls: "mistake", bestSan: "Qg4", bestUci: "d1g4", before: { mate: 3 }, after: { cp: 500 } });
    expect(p).toMatchObject({ tone: "improve", label: "Missed forced mate", cls: "mistake" });
    expect(p?.title).toContain("Mate in 3");
  });

  it("labels a slip where the better move was a check", () => {
    const p = point({ cls: "inaccuracy", bestSan: "Bb5+", bestUci: "f1b5" });
    expect(p).toMatchObject({ tone: "improve", label: "Missed check", cls: "inaccuracy" });
  });

  it("labels a slip where the better move was a capture", () => {
    expect(point({ cls: "mistake", bestSan: "Nxe5", bestUci: "f3e5" })?.label).toBe("Missed capture");
  });

  it("prefers the check label when the better move both captures and checks", () => {
    expect(point({ cls: "blunder", bestSan: "Qxf7+", bestUci: "h5f7" })?.label).toBe("Missed check");
  });

  it("falls back to the grade as the label for a quiet better move", () => {
    expect(point({ cls: "blunder", bestSan: "d4", bestUci: "d2d4" })?.label).toBe("Blunder");
    expect(point({ cls: "inaccuracy", bestSan: "d4", bestUci: "d2d4" })?.label).toBe("Inaccuracy");
  });

  it("does not stop on good or best moves without a missed mate", () => {
    expect(point({ cls: "good", bestSan: "d4", bestUci: "d2d4", before: { cp: 30 }, after: { cp: 20 } })).toBeNull();
    expect(point({ cls: "best", bestSan: "Nf3", bestUci: "g1f3" })).toBeNull();
  });

  it("never stops on the opponent's moves, however bad", () => {
    const history = [
      entry("e4", "w", { cls: "best" }),
      entry("Ke7", "b", { cls: "blunder", bestSan: "Qh4#", bestUci: "d8h4", before: { mate: 1 }, after: { cp: -200 } }),
    ];
    expect(teachSteps(buildLesson(history, "w").steps)).toEqual([]);
  });

  it("teaches the player's slips when the player has Black", () => {
    const history = [
      entry("e4", "w"),
      entry("f6", "b", { cls: "mistake", bestSan: "e5", bestUci: "e7e5", before: { cp: -30 }, after: { cp: -150 } }),
    ];
    const lesson = buildLesson(history, "b");
    expect(teachSteps(lesson.steps)).toMatchObject([{ kind: "teach", ply: 1 }]);
    expect(lesson.points).toBe(1);
  });
});

describe("buildLesson tallies", () => {
  it("counts only the player's grades and unreviewed moves", () => {
    const history = [
      entry("e4", "w", { cls: "best" }),
      entry("e5", "b", { cls: "blunder" }),
      entry("Nf3", "w", { cls: "good" }),
      entry("Nc6", "b"),
      entry("Bc4", "w", { cls: "mistake", bestSan: "Bb5", bestUci: "f1b5" }),
      entry("Nf6", "b"),
      entry("Ng5", "w"),
    ];
    const lesson = buildLesson(history, "w");
    expect(lesson.counts).toEqual({ best: 1, good: 1, inaccuracy: 0, mistake: 1, blunder: 0 });
    expect(lesson.unreviewed).toBe(1);
  });

  it("counts teaching stops and praise separately", () => {
    const history = [
      entry("Nf3", "w", { cls: "blunder", bestSan: "d4", bestUci: "d2d4", before: { cp: 20 }, after: { cp: -300 } }),
      entry("e5", "b"),
      entry("Qh5#", "w", { cls: "best", bestSan: "Qh5#", bestUci: "d1h5", before: { mate: 1 }, after: { mate: 1 } }),
    ];
    const lesson = buildLesson(history, "w");
    expect(lesson.points).toBe(1);
    expect(lesson.praise).toBe(1);
  });
});

describe("hasLessonData", () => {
  it("is true once any of the player's moves has a grade", () => {
    expect(hasLessonData([entry("e4", "w", { cls: "best" }), entry("e5", "b")], "w")).toBe(true);
  });

  it("is false when only the opponent's moves are graded", () => {
    expect(hasLessonData([entry("e4", "w"), entry("e5", "b", { cls: "good" })], "w")).toBe(false);
  });

  it("is false for an empty game", () => {
    expect(hasLessonData([], "b")).toBe(false);
  });
});
