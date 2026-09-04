import { describe, it, expect } from "vitest";
import { mailSnapshot, hydrateMailFromProfile } from "./mailSync";
import { loadVips, toggleVip, VIP_MAX } from "./vip";
import { loadRules, saveRule } from "./rules";
import { loadMuted, mute } from "./mute";
import { loadLetGo, letGo } from "./letGo";

// S2-5: "Everything JARVIS learns about your mail is device-only." These
// four stores are real localStorage, real per-device -- the whole point of
// this module is the bridge between them and the synced profile, without
// turning localStorage itself into something that has to wait on a network
// round trip to be trustworthy.

function fakeStorage() {
  const s: Record<string, string> = {};
  return { getItem: (k: string) => s[k] ?? null, setItem: (k: string, v: string) => { s[k] = v; }, raw: s };
}

describe("mailSnapshot", () => {
  it("is exactly what the four stores hold, nothing more", () => {
    const storage = fakeStorage();
    toggleVip("ridgeley@x.com", storage);
    saveRule("promo@x.com", "noise", storage);
    mute("t1", storage);
    letGo("t2", storage);
    expect(mailSnapshot(storage)).toEqual({
      vips: ["ridgeley@x.com"],
      rules: { "promo@x.com": "noise" },
      muted: ["t1"],
      letGo: ["t2"],
    });
  });

  it("empty stores snapshot to empty, not missing", () => {
    const storage = fakeStorage();
    expect(mailSnapshot(storage)).toEqual({ vips: [], rules: {}, muted: [], letGo: [] });
  });
});

describe("hydrateMailFromProfile", () => {
  it("with nothing local, pulls every field down from the profile and writes it back to storage", () => {
    const storage = fakeStorage();
    const grown = hydrateMailFromProfile(
      { vips: ["a@x.com"], rules: { "b@x.com": "noise" }, muted: ["t1"], letGo: ["t2"] },
      storage,
    );
    expect(grown).toEqual({ vips: ["a@x.com"], rules: { "b@x.com": "noise" }, muted: ["t1"], letGo: ["t2"] });
    // Actually landed in storage, not just returned -- the next load's
    // synchronous read has to see it without waiting on the network again.
    expect(loadVips(storage)).toEqual(["a@x.com"]);
    expect(loadRules(storage)).toEqual({ "b@x.com": "noise" });
    expect(loadMuted(storage)).toEqual(["t1"]);
    expect(loadLetGo(storage)).toEqual(["t2"]);
  });

  it("never overwrites a field that already has local data -- a deliberate local decision wins", () => {
    const storage = fakeStorage();
    toggleVip("local@x.com", storage);
    saveRule("localrule@x.com", "worth_knowing", storage);
    const grown = hydrateMailFromProfile(
      { vips: ["fromprofile@x.com"], rules: { "fromprofile@x.com": "noise" } },
      storage,
    );
    expect(grown).toEqual({});
    expect(loadVips(storage)).toEqual(["local@x.com"]);
    expect(loadRules(storage)).toEqual({ "localrule@x.com": "worth_knowing" });
  });

  it("fills in only the fields that are actually empty, leaving the rest untouched", () => {
    const storage = fakeStorage();
    toggleVip("local@x.com", storage); // vips already has local data
    const grown = hydrateMailFromProfile(
      { vips: ["fromprofile@x.com"], muted: ["t9"] },
      storage,
    );
    expect(grown).toEqual({ muted: ["t9"] }); // vips untouched, muted filled in
    expect(loadVips(storage)).toEqual(["local@x.com"]);
    expect(loadMuted(storage)).toEqual(["t9"]);
  });

  it("undefined or empty mail hydrates nothing", () => {
    const storage = fakeStorage();
    expect(hydrateMailFromProfile(undefined, storage)).toEqual({});
    expect(hydrateMailFromProfile({}, storage)).toEqual({});
    expect(hydrateMailFromProfile({ vips: [], rules: {}, muted: [], letGo: [] }, storage)).toEqual({});
  });

  it("still respects the VIP cap when hydrating a longer list from another device", () => {
    const storage = fakeStorage();
    const many = ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com", "f@x.com"];
    const grown = hydrateMailFromProfile({ vips: many }, storage);
    expect(grown.vips).toHaveLength(VIP_MAX);
    expect(loadVips(storage)).toHaveLength(VIP_MAX);
  });
});
