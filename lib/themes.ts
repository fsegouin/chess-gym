import { useSyncExternalStore } from "react";

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
  ui: {
    bg: string;
    bg2: string;
    surface: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentText: string;
  };
}

export const THEMES: Record<ThemeId, Theme> = {
  porcelain: {
    id: "porcelain",
    name: "Porcelain",
    scheme: "light",
    board: { light: "#e3dacb", dark: "#ae9f88", frame: "#cdc3b1", label: "#82786a" },
    pieces: { white: "#fdfcf8", black: "#2c2c30" },
    ui: {
      bg: "#f4f2ed",
      bg2: "#e3dfd6",
      surface: "rgba(255, 255, 255, 0.72)",
      text: "#1f1e1c",
      muted: "#6e695f",
      border: "rgba(31, 30, 28, 0.1)",
      accent: "#1f1e1c",
      accentText: "#f8f6f1",
    },
  },
  midnight: {
    id: "midnight",
    name: "Midnight",
    scheme: "dark",
    board: { light: "#666d7a", dark: "#3b414c", frame: "#1a1d23", label: "#737a87" },
    pieces: { white: "#eeece6", black: "#101115" },
    ui: {
      bg: "#13151a",
      bg2: "#08090c",
      surface: "rgba(30, 33, 40, 0.8)",
      text: "#ebeae6",
      muted: "#8f949d",
      border: "rgba(255, 255, 255, 0.08)",
      accent: "#ebeae6",
      accentText: "#13151a",
    },
  },
  graphite: {
    id: "graphite",
    name: "Graphite",
    scheme: "dark",
    board: { light: "#7a7d84", dark: "#4a4d54", frame: "#2a2c31", label: "#8d9097" },
    pieces: { white: "#f1efea", black: "#18181b" },
    ui: {
      bg: "#202125",
      bg2: "#131417",
      surface: "rgba(38, 40, 45, 0.78)",
      text: "#ecebe8",
      muted: "#9a9ca2",
      border: "rgba(255, 255, 255, 0.09)",
      accent: "#ecebe8",
      accentText: "#18191c",
    },
  },
  walnut: {
    id: "walnut",
    name: "Walnut",
    scheme: "light",
    board: { light: "#e8d3ad", dark: "#a97b52", frame: "#6f4b31", label: "#e8d3ad" },
    pieces: { white: "#f7f1e6", black: "#2a211c" },
    ui: {
      bg: "#f3ede3",
      bg2: "#e2d6c3",
      surface: "rgba(255, 252, 246, 0.74)",
      text: "#2a211c",
      muted: "#7a6a5a",
      border: "rgba(42, 33, 28, 0.12)",
      accent: "#6f4b31",
      accentText: "#fbf6ee",
    },
  },
  sage: {
    id: "sage",
    name: "Sage",
    scheme: "light",
    board: { light: "#e5eadf", dark: "#91a68c", frame: "#d0d8c8", label: "#6f8169" },
    pieces: { white: "#fbfbf7", black: "#26302a" },
    ui: {
      bg: "#eff2eb",
      bg2: "#dce3d5",
      surface: "rgba(255, 255, 255, 0.72)",
      text: "#1e2620",
      muted: "#5f6e61",
      border: "rgba(30, 38, 32, 0.1)",
      accent: "#3f5a45",
      accentText: "#f5f8f2",
    },
  },
};
