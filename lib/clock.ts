export type TimeCategory = "Bullet" | "Blitz" | "Rapid" | "Classical";

export interface TimeControl {
  id: string;
  category: TimeCategory;
  /** Starting time per player. */
  initialMs: number;
  /** Added to a player's clock after each of their moves. */
  incrementMs: number;
}

const preset = (minutes: number, increment: number, category: TimeCategory): TimeControl => ({
  id: `${minutes}+${increment}`,
  category,
  initialMs: minutes * 60_000,
  incrementMs: increment * 1000,
});

export const TIME_CONTROLS: TimeControl[] = [
  preset(1, 0, "Bullet"),
  preset(2, 1, "Bullet"),
  preset(3, 0, "Blitz"),
  preset(3, 2, "Blitz"),
  preset(5, 0, "Blitz"),
  preset(5, 3, "Blitz"),
  preset(10, 0, "Rapid"),
  preset(10, 5, "Rapid"),
  preset(15, 10, "Rapid"),
  preset(30, 0, "Classical"),
  preset(30, 20, "Classical"),
];

/** "none" means no limit: the clocks count up instead of down. */
export const TIME_CONTROL_IDS: readonly string[] = ["none", ...TIME_CONTROLS.map((c) => c.id)];

export function getTimeControl(id: string): TimeControl | null {
  return TIME_CONTROLS.find((c) => c.id === id) ?? null;
}

export function describeTimeControl(id: string): string {
  const c = getTimeControl(id);
  if (!c) return "No time limit";
  const minutes = c.initialMs / 60_000;
  const increment = c.incrementMs / 1000;
  return `${c.category}, ${minutes} min${increment ? ` + ${increment} s per move` : ""}`;
}

/** m:ss, h:mm:ss past an hour, and tenths of a second under ten seconds. */
export function formatClock(ms: number, showTenths = true): string {
  const clamped = Math.max(0, ms);
  if (showTenths && clamped < 10_000) return `0:0${(Math.floor(clamped / 100) / 10).toFixed(1)}`;
  const total = Math.floor(clamped / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function clockSpeech(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m} minute${m === 1 ? "" : "s"} ${s} second${s === 1 ? "" : "s"}` : `${s} second${s === 1 ? "" : "s"}`;
}
