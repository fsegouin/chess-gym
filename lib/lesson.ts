import type { Color } from "chess.js";
import { CLASS_LABEL, formatScore, toCp, winningChances, type MoveClass } from "./coach";
import type { Score } from "./engine";
import type { HistoryEntry } from "./game";

/** A moment in the player's game worth stopping on: a slip to learn from, or a move to praise. */
export interface TeachingPoint {
  ply: number;
  tone: "improve" | "praise";
  /** Short label for the badge, e.g. "Missed checkmate" or "Mistake". */
  label: string;
  title: string;
  text: string;
  cls: MoveClass;
  playedUci: string;
  bestUci: string;
}

export type LessonStep =
  | { kind: "intro" }
  | { kind: "teach"; ply: number; point: TeachingPoint }
  | { kind: "move"; ply: number }
  | { kind: "summary" };

export interface Lesson {
  steps: LessonStep[];
  /** Stops to learn from, and stops on moves that shaped the game. */
  points: number;
  praise: number;
  /** Grades of the player's reviewed moves. */
  counts: Record<MoveClass, number>;
  /** Player moves without a coach grade, e.g. played in Play mode before switching. */
  unreviewed: number;
}

const WEAK: MoveClass[] = ["inaccuracy", "mistake", "blunder"];

export function teachingPoint(entry: HistoryEntry, ply: number): TeachingPoint | null {
  const a = entry.annotation;
  if (!a?.bestSan || !a.bestUci) return null;
  const best = a.bestSan;
  const played = entry.san;
  const missedMateInOne = best.endsWith("#") && !played.endsWith("#");
  const hadForcedMate = "mate" in a.before && a.before.mate > 0;
  const keptForcedMate = "mate" in a.after && a.after.mate > 0;
  const weak = WEAK.includes(a.cls);
  if (!weak && !missedMateInOne && !(hadForcedMate && !keptForcedMate)) return null;

  const swing = `Your position went from ${formatScore(a.before)} to ${formatScore(a.after)}.`;
  const base = { ply, tone: "improve" as const, cls: a.cls, playedUci: entry.from + entry.to, bestUci: a.bestUci };

  if (missedMateInOne) {
    return {
      ...base,
      label: "Missed checkmate",
      title: `${best} was checkmate`,
      text: `You played ${played}, but ${best} would have ended the game on the spot. Before each move, look for checks first.`,
    };
  }
  if (hadForcedMate && !keptForcedMate && "mate" in a.before) {
    const n = a.before.mate;
    return {
      ...base,
      label: "Missed forced mate",
      title: `Mate in ${n} started with ${best}`,
      text: `${best} began a forced checkmate in ${n}. ${played} let it slip. ${swing}`,
    };
  }
  if (best.includes("+")) {
    return {
      ...base,
      label: "Missed check",
      title: `${best} was a strong check`,
      text: `${best} gives check and keeps the initiative. ${played} was weaker. ${swing}`,
    };
  }
  if (best.includes("x")) {
    return {
      ...base,
      label: "Missed capture",
      title: `${best} wins material`,
      text: `${best} captures and comes out ahead. ${played} left that on the board. ${swing}`,
    };
  }
  return {
    ...base,
    label: CLASS_LABEL[a.cls],
    title: `${best} was stronger than ${played}`,
    text: `${swing} The green arrow shows the coach's choice; the orange one is what you played.`,
  };
}

const chances = (score: Score) => winningChances(toCp(score));
const hasMate = (score: Score | undefined) => !!score && "mate" in score && score.mate > 0;

/** How much the opponent's reply must hand over, in winning chances, to count as a slip. */
const PUNISH_SWING = 0.25;

/**
 * A move that shaped the game: delivering mate, starting a forced mate, or keeping hold of the
 * advantage the opponent just gave away. `prevAfter` is the evaluation after the player's previous
 * move, so the gap to this move's `before` is what the opponent's reply changed.
 */
function praisePoint(entry: HistoryEntry, ply: number, prevAfter: Score | undefined): TeachingPoint | null {
  const a = entry.annotation;
  if (!a || (a.cls !== "best" && a.cls !== "good")) return null;
  const played = entry.san;
  const base = { ply, tone: "praise" as const, cls: a.cls, playedUci: entry.from + entry.to, bestUci: entry.from + entry.to };

  if (played.endsWith("#")) {
    return { ...base, label: "Checkmate", title: `${played} ends the game`, text: "You saw the mate and finished it cleanly." };
  }
  if (hasMate(a.before) && hasMate(a.after) && !hasMate(prevAfter) && "mate" in a.before) {
    const n = a.before.mate;
    return {
      ...base,
      label: "Found a forced mate",
      title: `${played} starts a mate in ${n}`,
      text: `From here the win is forced. Spotting a mating sequence the moment it appears is what turns good positions into wins.`,
    };
  }
  if (prevAfter && chances(a.before) - chances(prevAfter) >= PUNISH_SWING) {
    return {
      ...base,
      label: "Punished a mistake",
      title: `${played} made the opponent pay`,
      text: `Their last move gave you a chance, and you took it: your position went from ${formatScore(prevAfter)} to ${formatScore(a.after)}. Moments like this decide games.`,
    };
  }
  return null;
}

/** The game replayed move by move, with a stop before each of the player's teaching moments. */
export function buildLesson(history: HistoryEntry[], playerColor: Color): Lesson {
  const steps: LessonStep[] = [{ kind: "intro" }];
  const counts: Record<MoveClass, number> = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  let points = 0;
  let praise = 0;
  let unreviewed = 0;
  let prevAfter: Score | undefined;
  history.forEach((entry, ply) => {
    if (entry.color === playerColor) {
      if (entry.annotation) counts[entry.annotation.cls]++;
      else unreviewed++;
      const point = teachingPoint(entry, ply) ?? praisePoint(entry, ply, prevAfter);
      if (point) {
        steps.push({ kind: "teach", ply, point });
        if (point.tone === "praise") praise++;
        else points++;
      }
      prevAfter = entry.annotation?.after;
    }
    steps.push({ kind: "move", ply });
  });
  steps.push({ kind: "summary" });
  return { steps, points, praise, counts, unreviewed };
}

const SLOWEST_MS = 1100;
const FASTEST_MS = 320;
/** How many quiet moves it takes to get most of the way from slowest to fastest. */
const EASE_MOVES = 1.6;

/**
 * Playback pace for a replayed move: slow next to a stop (the intro, a teaching moment or the
 * end), easing up to full speed through quiet stretches and back down before the next stop.
 * Returns the delay before the next step and how much faster pieces should animate.
 */
export function lessonPace(steps: LessonStep[], index: number): { delayMs: number; speed: number } {
  let back = 0;
  for (let i = index - 1; i >= 0 && steps[i].kind === "move"; i--) back++;
  let ahead = 0;
  for (let i = index + 1; i < steps.length && steps[i].kind === "move"; i++) ahead++;
  const calm = Math.min(back, ahead);
  const delayMs = FASTEST_MS + (SLOWEST_MS - FASTEST_MS) * Math.exp(-calm / EASE_MOVES);
  return { delayMs, speed: Math.min(2.5, Math.max(1, (SLOWEST_MS / delayMs) * 0.8)) };
}

/** Whether the game has any coach grades to teach from. */
export function hasLessonData(history: HistoryEntry[], playerColor: Color): boolean {
  return history.some((h) => h.color === playerColor && h.annotation);
}
