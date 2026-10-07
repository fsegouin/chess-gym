import { vi } from "vitest";

/** A browser stand-in for modules that guard on `window` and persist to localStorage. */
export function stubBrowser(entries: Record<string, unknown> = {}): Map<string, string> {
  const store = new Map<string, string>();
  for (const [key, value] of Object.entries(entries)) {
    store.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}
