import { describe, it, expect } from "vitest";
import { readGymSettings, writeGymSettings, DEFAULT_GYM_SETTINGS, type GymSettings } from "./settings";
import type { Storage2 } from "./liveSession";

function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

// D2 (Training Catalog V2, approved 2026-08-31): the ghosts default ON --
// "It should always be visible in my opinion unless they want to turn that
// off" -- and the switch lives in Settings → Training.
describe("gym settings", () => {
  it("defaults showLast ON with nothing stored", () => {
    expect(readGymSettings(mem()).showLast).toBe(true);
    expect(DEFAULT_GYM_SETTINGS.showLast).toBe(true);
  });

  it("round-trips a turned-off switch", () => {
    const s = mem();
    writeGymSettings({ ...DEFAULT_GYM_SETTINGS, showLast: false }, s);
    expect(readGymSettings(s).showLast).toBe(false);
  });

  it("a corrupt read heals to defaults instead of throwing", () => {
    const s = mem();
    s.write("jarvis.gym.settings.v1", "{nope");
    expect(readGymSettings(s).showLast).toBe(true);
  });

  it("future fields survive: unknown keys merge over defaults, missing keys fill in", () => {
    const s = mem();
    s.write("jarvis.gym.settings.v1", JSON.stringify({ barWeight: 45 }));
    const out = readGymSettings(s) as GymSettings & { barWeight?: number };
    expect(out.showLast).toBe(true); // default fills the gap
    expect(out.barWeight).toBe(45); // Wave 2's field is not destroyed by Wave 1's reader
  });
});

// D8-A: the rack is the athlete's, and a broken one never breaks the math.
describe("the rack", () => {
  it("defaults to a normal bar and plates", () => {
    const s = readGymSettings(mem());
    expect(s.barWeight).toBe(45);
    expect(s.plates).toContain(45);
  });

  it("a kg lifter's own rack round-trips", () => {
    const store = mem();
    writeGymSettings({ ...DEFAULT_GYM_SETTINGS, barWeight: 20, plates: [25, 20, 15, 10, 5, 2.5] }, store);
    expect(readGymSettings(store).barWeight).toBe(20);
  });

  it("an empty or nonsense rack falls back instead of dividing by nothing", async () => {
    const { rackFrom } = await import("./settings");
    expect(rackFrom({ showLast: true, barWeight: 0, plates: [] }).bar).toBe(45);
    expect(rackFrom({ showLast: true, barWeight: 45, plates: [] }).plates.length).toBeGreaterThan(0);
    expect(rackFrom({ showLast: true, barWeight: 45, plates: [-5, 45] }).plates).toEqual([45]);
  });
});
