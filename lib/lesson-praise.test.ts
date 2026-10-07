import type { Color } from "chess.js";
import { describe, expect, it } from "vitest";
import type { Annotation } from "./coach";
import type { Score } from "./engine";
import type { HistoryEntry } from "./game";
import { buildLesson, lessonPace, type LessonStep, type TeachingPoint } from "./lesson";

function entry(san: string, color: Color, annotation: Partial<Annotation> | null = null): HistoryEntry {
  return {
    san,
    color,
    from: "d1",
    to: "h5",
    before: "",
    after: "",
    annotation: annotation && { cls: "good", bestSan: null, bestUci: null, before: { cp: 0 }, after: { cp: 0 }, ...annotation },
  };
}

/** The player (White) moves, the opponent replies, then the player moves again. */
function pointOnSecondMove(firstAfter: Score | null, second: Partial<Annotation>, san = "Qh5"): TeachingPoint[] {
  const history = [
    entry("e4", "w", firstAfter ? { cls: "good", after: firstAfter } : null),
    entry("f6", "b"),
    entry(san, "w", second),
  ];
  return buildLesson(history, "w").steps.flatMap((s) => (s.kind === "teach" ? [s.point] : []));
}

describe("buildLesson praise", () => {
  it("praises delivering checkmate", () => {
    const points = pointOnSecondMove({ cp: 30 }, { cls: "best", bestSan: "Qh5#", bestUci: "d1h5", before: { mate: 1 }, after: { mate: 1 } }, "Qh5#");
    expect(points).toMatchObject([{ tone: "praise", label: "Checkmate", ply: 2 }]);
  });

  it("praises starting a forced mate that was not there before", () => {
    const points = pointOnSecondMove({ cp: 30 }, { cls: "best", bestSan: "Qh5+", bestUci: "d1h5", before: { mate: 3 }, after: { mate: 2 } }, "Qh5+");
    expect(points).toMatchObject([{ tone: "praise", label: "Found a forced mate" }]);
    expect(points[0].title).toContain("mate in 3");
  });

  it("does not praise continuing a forced mate that was already on the board", () => {
    const points = pointOnSecondMove({ mate: 4 }, { cls: "best", bestSan: "Qh5+", bestUci: "d1h5", before: { mate: 3 }, after: { mate: 2 } }, "Qh5+");
    expect(points).toEqual([]);
  });

  it("praises punishing an opponent mistake that swung 0.25 winning chances or more", () => {
    const points = pointOnSecondMove({ cp: 20 }, { cls: "best", bestSan: "Qh5", bestUci: "d1h5", before: { cp: 400 }, after: { cp: 380 } });
    expect(points).toMatchObject([{ tone: "praise", label: "Punished a mistake", cls: "best" }]);
  });

  it("also praises a good, not only best, punishing move", () => {
    const points = pointOnSecondMove({ cp: 20 }, { cls: "good", bestSan: "Nf3", bestUci: "g1f3", before: { cp: 400 }, after: { cp: 360 } });
    expect(points.map((p) => p.label)).toEqual(["Punished a mistake"]);
  });

  it("does not praise when the opponent's reply changed little", () => {
    const points = pointOnSecondMove({ cp: 20 }, { cls: "best", bestSan: "Qh5", bestUci: "d1h5", before: { cp: 80 }, after: { cp: 80 } });
    expect(points).toEqual([]);
  });

  it("does not praise a punishing chance the player then fumbled", () => {
    const points = pointOnSecondMove({ cp: 20 }, { cls: "mistake", bestSan: "Nf3", bestUci: "g1f3", before: { cp: 400 }, after: { cp: 150 } });
    expect(points.map((p) => p.tone)).toEqual(["improve"]);
  });

  it("does not look for a punished mistake on the player's first graded move", () => {
    const points = pointOnSecondMove(null, { cls: "best", bestSan: "Qh5", bestUci: "d1h5", before: { cp: 400 }, after: { cp: 380 } });
    expect(points).toEqual([]);
  });
});

function stretch(moves: number): LessonStep[] {
  return [{ kind: "intro" }, ...Array.from({ length: moves }, (_, ply) => ({ kind: "move" as const, ply })), { kind: "summary" }];
}

describe("lessonPace", () => {
  it("is slowest next to a stop", () => {
    const steps = stretch(10);
    expect(lessonPace(steps, 1)).toEqual({ delayMs: 1100, speed: 1 });
    expect(lessonPace(steps, 10).delayMs).toBe(1100);
  });

  it("treats a teaching moment as a stop", () => {
    const steps: LessonStep[] = [
      ...stretch(10).slice(0, 6),
      { kind: "teach", ply: 5, point: {} as TeachingPoint },
      ...stretch(10).slice(6),
    ];
    expect(lessonPace(steps, 5).delayMs).toBe(1100);
    expect(lessonPace(steps, 7).delayMs).toBe(1100);
  });

  it("reaches about 320 ms in the middle of a long quiet stretch", () => {
    const steps = stretch(40);
    expect(lessonPace(steps, 20).delayMs).toBeCloseTo(320, 0);
    expect(lessonPace(steps, 20).speed).toBe(2.5);
  });

  it("speeds up towards the middle and slows symmetrically towards the end", () => {
    const steps = stretch(12);
    const delays = steps.map((_, i) => lessonPace(steps, i).delayMs).slice(1, -1);
    for (let i = 1; i < 6; i++) expect(delays[i]).toBeLessThan(delays[i - 1]);
    for (let i = 0; i < 12; i++) expect(delays[i]).toBeCloseTo(delays[11 - i], 9);
  });

  it("keeps the animation speed between 1 and 2.5", () => {
    const steps = stretch(30);
    for (let i = 0; i < steps.length; i++) {
      const { speed } = lessonPace(steps, i);
      expect(speed).toBeGreaterThanOrEqual(1);
      expect(speed).toBeLessThanOrEqual(2.5);
    }
  });
});
