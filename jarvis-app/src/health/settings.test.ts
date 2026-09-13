import { describe, it, expect } from "vitest";
import { readHealthSettings, writeHealthSettings, updateHealthSettings, DEFAULT_HEALTH_SETTINGS } from "./settings";
import type { Storage2 } from "../gym/liveSession";

// Health Push C, H-40 (2026-09-12), and the band Dave would not have hard
// wired (2026-09-13).
function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

describe("health settings", () => {
  it("defaults to Bedtime alone, sound and notification on, celebrations on, the studied band", () => {
    expect(readHealthSettings(mem())).toEqual(DEFAULT_HEALTH_SETTINGS);
  });
  it("round-trips, and a patch keeps what it did not name", () => {
    const s = mem();
    writeHealthSettings({ ...DEFAULT_HEALTH_SETTINGS, shortcuts: ["bedtime", "water"] }, s);
    expect(readHealthSettings(s).shortcuts).toEqual(["bedtime", "water"]);
    updateHealthSettings({ celebrations: false }, s);
    expect(readHealthSettings(s)).toMatchObject({ shortcuts: ["bedtime", "water"], celebrations: false, restSound: true });
  });
  it("drops a shortcut it does not know and a band that makes no sense", () => {
    const s = mem();
    s.write("jarvis.health.settings.v1", JSON.stringify({ shortcuts: ["bedtime", "calories"], volumeBand: { low: 20, high: 10 } }));
    const r = readHealthSettings(s);
    expect(r.shortcuts).toEqual(["bedtime"]);
    expect(r.volumeBand).toBeNull();
  });
  it("keeps a band he set", () => {
    const s = mem();
    updateHealthSettings({ volumeBand: { low: 12, high: 18 } }, s);
    expect(readHealthSettings(s).volumeBand).toEqual({ low: 12, high: 18 });
  });
  it("reads the defaults off broken storage", () => {
    const s = mem();
    s.write("jarvis.health.settings.v1", "{not json");
    expect(readHealthSettings(s)).toEqual(DEFAULT_HEALTH_SETTINGS);
  });
});
