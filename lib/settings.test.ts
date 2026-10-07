import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";

const STORAGE_KEY = "chess3d.settings.v1";

/** A browser stand-in: `window` for the SSR guard and a Map-backed localStorage. */
function stubBrowser(stored?: unknown): Map<string, string> {
  const store = new Map<string, string>();
  if (stored !== undefined) store.set(STORAGE_KEY, typeof stored === "string" ? stored : JSON.stringify(stored));
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

/** A fresh copy of the module, since it caches settings after the first read. */
async function loadSettings() {
  vi.resetModules();
  return import("./settings");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getSettings", () => {
  it("returns the defaults during server rendering", async () => {
    const { getSettings } = await loadSettings();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns the defaults when nothing is stored", async () => {
    stubBrowser();
    expect((await loadSettings()).getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("returns the defaults when stored data is not valid JSON", async () => {
    stubBrowser("{oops");
    expect((await loadSettings()).getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("repairs invalid stored fields and keeps valid ones", async () => {
    stubBrowser({ elo: 99_999, theme: "neon", sound: "yes", mode: "play", timeControl: "3+2", quality: "ultra" });
    const settings = (await loadSettings()).getSettings();
    expect(settings).toMatchObject({ elo: 3000, theme: "auto", sound: true, mode: "play", timeControl: "3+2", quality: "high" });
  });
});

describe("updateSettings", () => {
  it("keeps valid values", async () => {
    stubBrowser();
    const { updateSettings, getSettings } = await loadSettings();
    updateSettings({ theme: "midnight", timeControl: "5+3", pauseOn: "blunder", playerColor: "random", showEvalBar: false });
    expect(getSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "midnight",
      timeControl: "5+3",
      pauseOn: "blunder",
      playerColor: "random",
      showEvalBar: false,
    });
  });

  it("clamps elo to 400..3000 and rounds it", async () => {
    stubBrowser();
    const { updateSettings, getSettings } = await loadSettings();
    updateSettings({ elo: 5000 });
    expect(getSettings().elo).toBe(3000);
    updateSettings({ elo: 50 });
    expect(getSettings().elo).toBe(400);
    updateSettings({ elo: 1234.6 });
    expect(getSettings().elo).toBe(1235);
  });

  it("rejects unknown enum values", async () => {
    stubBrowser();
    const { updateSettings, getSettings } = await loadSettings();
    updateSettings({ theme: "neon", timeControl: "7+7", mode: "blitz", pauseOn: "never" } as never);
    expect(getSettings()).toMatchObject({
      theme: DEFAULT_SETTINGS.theme,
      timeControl: DEFAULT_SETTINGS.timeControl,
      mode: DEFAULT_SETTINGS.mode,
      pauseOn: DEFAULT_SETTINGS.pauseOn,
    });
  });

  it("leaves other settings untouched", async () => {
    stubBrowser({ ...DEFAULT_SETTINGS, elo: 1800, sound: false });
    const { updateSettings, getSettings } = await loadSettings();
    updateSettings({ theme: "sage" });
    expect(getSettings()).toMatchObject({ elo: 1800, sound: false, theme: "sage" });
  });

  it("persists so a fresh load sees the change", async () => {
    const store = stubBrowser();
    (await loadSettings()).updateSettings({ elo: 2000, timeControl: "10+5" });
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "null")).toMatchObject({ elo: 2000, timeControl: "10+5" });
    expect((await loadSettings()).getSettings()).toMatchObject({ elo: 2000, timeControl: "10+5" });
  });

  it("still applies the change when storage refuses to save", async () => {
    stubBrowser();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });
    const { updateSettings, getSettings } = await loadSettings();
    updateSettings({ sound: false });
    expect(getSettings().sound).toBe(false);
  });
});
