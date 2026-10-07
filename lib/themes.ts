import { useSyncExternalStore } from "react";
import type { BoardFinish, PieceFinish } from "./scene/textures";

export const THEME_IDS = ["porcelain", "midnight", "graphite", "walnut", "sage"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
/** "auto" follows the operating system: Porcelain in light mode, Midnight in dark mode. */
export type ThemeChoice = ThemeId | "auto";
export const THEME_CHOICES: readonly ThemeChoice[] = ["auto", ...THEME_IDS];

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ThemeId {
  if (choice !== "auto") return choice;
  return prefersDark ? "midnight" : "porcelain";
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(listener: () => void): () => void {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

export function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

export function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribeScheme, prefersDark, () => false);
}

export interface Theme {
  id: ThemeId;
  name: string;
  /** Whether the surrounding UI is light or dark. */
  scheme: "light" | "dark";
  board: {
    light: string;
    dark: string;
    frame: string;
    label: string;
  };
  pieces: {
    white: string;
    black: string;
  };
  /** Surface treatment: what the pieces are made of and how the board is cut. */
  finish: {
    pieces: PieceFinish;
    board: BoardFinish;
  };
  ui: {
    bg: string;
    bg2: string;
    surface: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentText: string;
    /** Focus rings and the keyboard cursor on the board; at least 3:1 against bg and bg2. */
    focus: string;
  };
}

export const THEMES: Record<ThemeId, Theme> = {
  porcelain: {
    id: "porcelain",
    name: "Porcelain",
    scheme: "light",
    board: { light: "#e3dacb", dark: "#ae9f88", frame: "#cdc3b1", label: "#82786a" },
    pieces: { white: "#e6e0d3", black: "#2c2c30" },
    finish: { pieces: "ceramic", board: "smooth" },
    ui: {
      bg: "#f4f2ed",
      bg2: "#e3dfd6",
      surface: "rgba(255, 255, 255, 0.72)",
      text: "#1f1e1c",
      muted: "#5d584f",
      border: "rgba(31, 30, 28, 0.1)",
      accent: "#1f1e1c",
      accentText: "#f8f6f1",
      focus: "#1f6fd1",
    },
  },
  midnight: {
    id: "midnight",
    name: "Midnight",
    scheme: "dark",
    board: { light: "#5c6370", dark: "#3b414c", frame: "#1a1d23", label: "#737a87" },
    pieces: { white: "#d9dce1", black: "#3a3e45" },
    finish: { pieces: "metal", board: "stone" },
    ui: {
      bg: "#13151a",
      bg2: "#08090c",
      surface: "rgba(30, 33, 40, 0.8)",
      text: "#ebeae6",
      muted: "#8f949d",
      border: "rgba(255, 255, 255, 0.08)",
      accent: "#ebeae6",
      accentText: "#13151a",
      focus: "#7cb4ff",
    },
  },
  graphite: {
    id: "graphite",
    name: "Graphite",
    scheme: "dark",
    board: { light: "#7a7d84", dark: "#4a4d54", frame: "#2a2c31", label: "#8d9097" },
    pieces: { white: "#d8d5cd", black: "#2a2b2f" },
    finish: { pieces: "stone", board: "stone" },
    ui: {
      bg: "#202125",
      bg2: "#131417",
      surface: "rgba(38, 40, 45, 0.78)",
      text: "#ecebe8",
      muted: "#9a9ca2",
      border: "rgba(255, 255, 255, 0.09)",
      accent: "#ecebe8",
      accentText: "#18191c",
      focus: "#7cb4ff",
    },
  },
  walnut: {
    id: "walnut",
    name: "Walnut",
    scheme: "light",
    board: { light: "#e8d3ad", dark: "#a97b52", frame: "#6f4b31", label: "#e8d3ad" },
    pieces: { white: "#e8cc9a", black: "#4a2a1c" },
    finish: { pieces: "wood", board: "wood" },
    ui: {
      bg: "#f3ede3",
      bg2: "#e2d6c3",
      surface: "rgba(255, 252, 246, 0.74)",
      text: "#2a211c",
      muted: "#64564a",
      border: "rgba(42, 33, 28, 0.12)",
      accent: "#6f4b31",
      accentText: "#fbf6ee",
      focus: "#1f6fd1",
    },
  },
  sage: {
    id: "sage",
    name: "Sage",
    scheme: "light",
    board: { light: "#e5eadf", dark: "#91a68c", frame: "#d0d8c8", label: "#6f8169" },
    pieces: { white: "#e6e4da", black: "#2c3a31" },
    finish: { pieces: "clay", board: "smooth" },
    ui: {
      bg: "#eff2eb",
      bg2: "#dce3d5",
      surface: "rgba(255, 255, 255, 0.72)",
      text: "#1e2620",
      muted: "#55635a",
      border: "rgba(30, 38, 32, 0.1)",
      accent: "#3f5a45",
      accentText: "#f5f8f2",
      focus: "#1f6fd1",
    },
  },
};
