import { useSyncExternalStore } from "react";
import { TIME_CONTROL_IDS } from "./clock";
import { THEME_CHOICES, type ThemeChoice } from "./themes";

export type GameMode = "play" | "training";
export type PlayerColorChoice = "w" | "b" | "random";
export type PauseThreshold = "inaccuracy" | "mistake" | "blunder";
export type Quality = "low" | "high";

export interface Settings {
  mode: GameMode;
  elo: number;
  playerColor: PlayerColorChoice;
  theme: ThemeChoice;
  showLegalMoves: boolean;
  showLastMove: boolean;
  sound: boolean;
  quality: Quality;
  /** Training mode: the smallest error that pauses the game for review. */
  pauseOn: PauseThreshold;
  showEvalBar: boolean;
  /** Time control for new games, "none" or a preset id such as "5+3". */
  timeControl: string;
}

export const ELO_MIN = 400;
export const ELO_MAX = 3000;

export const ELO_PRESETS = [
  { label: "Beginner", elo: 600 },
  { label: "Casual", elo: 1000 },
  { label: "Club", elo: 1500 },
  { label: "Expert", elo: 2000 },
  { label: "Master", elo: 2400 },
  { label: "Max", elo: ELO_MAX },
] as const;

export const MODE_OPTIONS: { value: GameMode; label: string }[] = [
  { value: "play", label: "Play" },
  { value: "training", label: "Training" },
];

export const PLAYER_COLOR_OPTIONS: { value: PlayerColorChoice; label: string }[] = [
  { value: "w", label: "White" },
  { value: "random", label: "Random" },
  { value: "b", label: "Black" },
];

export const DEFAULT_SETTINGS: Settings = {
  mode: "training",
  elo: 1200,
  playerColor: "w",
  theme: "auto",
  showLegalMoves: true,
  showLastMove: true,
  sound: true,
  quality: "high",
  pauseOn: "mistake",
  showEvalBar: true,
  timeControl: "none",
};

const STORAGE_KEY = "chess3d.settings.v1";

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Stored data may come from an older version or be hand-edited, so every field is checked. */
function sanitize(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const elo = typeof r.elo === "number" && Number.isFinite(r.elo) ? r.elo : d.elo;
  return {
    mode: pick(r.mode, ["play", "training"], d.mode),
    elo: Math.round(Math.min(ELO_MAX, Math.max(ELO_MIN, elo))),
    playerColor: pick(r.playerColor, ["w", "b", "random"], d.playerColor),
    theme: pick(r.theme, THEME_CHOICES, d.theme),
    showLegalMoves: bool(r.showLegalMoves, d.showLegalMoves),
    showLastMove: bool(r.showLastMove, d.showLastMove),
    sound: bool(r.sound, d.sound),
    quality: pick(r.quality, ["low", "high"], d.quality),
    pauseOn: pick(r.pauseOn, ["inaccuracy", "mistake", "blunder"], d.pauseOn),
    showEvalBar: bool(r.showEvalBar, d.showEvalBar),
    timeControl: pick(r.timeControl, TIME_CONTROL_IDS, d.timeControl),
  };
}

function read(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  current ??= read();
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = sanitize({ ...getSettings(), ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage can be full or blocked (private mode); settings still apply for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Keep several open tabs in sync.
  const onStorage = (e: StorageEvent) => {
    // A null key means another tab cleared all storage.
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    current = read();
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
}
