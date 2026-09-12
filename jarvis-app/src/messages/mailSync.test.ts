import { describe, it, expect } from "vitest";
import { mailSnapshot, hydrateMailFromProfile } from "./mailSync";
import { loadVips, toggleVip, VIP_MAX } from "./vip";
import { loadRules, saveRule, type SenderRules } from "./rules";
import { loadMuted, mute } from "./mute";
import { loadLetGo, letGo } from "./letGo";
import { loadLinks, linkThread } from "./threadLink";
import { setAtDesk, loadDesk } from "./desk";

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
  // EMAIL-F-19 (2026-09-05): project links were the one thing JARVIS learned
  // about his mail that never left the device, so a thread filed on the phone
  // was unfiled everywhere else.
  // UP-MIND-09 (2026-09-08): six now. The desk store MUST cross devices or
  // the feature is a lie: the whole promise is that a thread set aside on the
  // phone is sitting on the laptop when he gets there.
  it("is exactly what the six stores hold, nothing more", () => {
    const storage = fakeStorage();
    toggleVip("ridgeley@x.com", storage);
    saveRule("promo@x.com", "noise", storage);
    mute("t1", storage);
    letGo("t2", storage);
    linkThread("t3", { type: "project", id: "p1", label: "Ridgeley", subject: "The waiver" }, storage);
    setAtDesk("t4", () => Date.parse("2026-09-08T10:00:00Z"), storage);
    expect(mailSnapshot(storage)).toEqual({
      vips: ["ridgeley@x.com"],
      rules: { "promo@x.com": { bucket: "noise", enabled: true } },
      muted: ["t1"],
      letGo: ["t2"],
      links: { t3: { type: "project", id: "p1", label: "Ridgeley", subject: "The waiver" } },
      desk: { t4: "2026-09-08T10:00:00.000Z" },
    });
  });

  it("empty stores snapshot to empty, not missing", () => {
    const storage = fakeStorage();
    expect(mailSnapshot(storage)).toEqual({ vips: [], rules: {}, muted: [], letGo: [], links: {}, desk: {} });
  });
});

describe("hydrateMailFromProfile", () => {
  it("with nothing local, pulls every field down from the profile and writes it back to storage", () => {
    const storage = fakeStorage();
    const grown = hydrateMailFromProfile(
      { vips: ["a@x.com"], rules: { "b@x.com": { bucket: "noise", enabled: true } }, muted: ["t1"], letGo: ["t2"] },
      storage,
    );
    expect(grown).toEqual({ vips: ["a@x.com"], rules: { "b@x.com": { bucket: "noise", enabled: true } }, muted: ["t1"], letGo: ["t2"] });
    // Actually landed in storage, not just returned -- the next load's
    // synchronous read has to see it without waiting on the network again.
    expect(loadVips(storage)).toEqual(["a@x.com"]);
    expect(loadRules(storage)).toEqual({ "b@x.com": { bucket: "noise", enabled: true } });
    expect(loadMuted(storage)).toEqual(["t1"]);
    expect(loadLetGo(storage)).toEqual(["t2"]);
  });

  // EMAIL-F-19: the link store hydrates like the other four, so the project
  // page on a second device shows the same conversations.
  it("pulls project links down too", () => {
    const storage = fakeStorage();
    const grown = hydrateMailFromProfile(
      { links: { t3: { type: "project", id: "p1", label: "Ridgeley", subject: "The waiver" } } },
      storage,
    );
    expect(grown.links).toEqual({ t3: { type: "project", id: "p1", label: "Ridgeley", subject: "The waiver" } });
    expect(loadLinks(storage).t3?.label).toBe("Ridgeley");
  });

  // EMAIL-F-30 (2026-09-05): "Cross-device mail mirror only fills an empty
  // device; two devices never converge." These two cases used to assert the
  // first-fill rule, which is the bug: a phone with one VIP never received
  // the two marked on the iPad, and its next toggle mirrored its own list
  // over the top. The stores are sets and keyed maps, so they merge.
  it("unions a list store rather than choosing a side", () => {
    const storage = fakeStorage();
    toggleVip("local@x.com", storage);
    const grown = hydrateMailFromProfile(
      { vips: ["fromprofile@x.com"], muted: ["t9"] },
      storage,
    );
    expect(grown.vips).toEqual(["local@x.com", "fromprofile@x.com"]);
    expect(loadVips(storage)).toEqual(["local@x.com", "fromprofile@x.com"]);
    expect(loadMuted(storage)).toEqual(["t9"]);
  });

  it("on a keyed store the local decision wins the conflict, and the rest still lands", () => {
    const storage = fakeStorage();
    saveRule("both@x.com", "worth_knowing", storage);
    // E-24: the profile still carries v1 strings from a device on the old
    // build; they arrive in the v2 shape, on, scoped to every account.
    const v1 = { "both@x.com": "noise", "onlyprofile@x.com": "noise" } as unknown as SenderRules;
    const grown = hydrateMailFromProfile({ rules: v1 }, storage);
    // The sender this device just filed keeps this device's answer; the one
    // it has never seen arrives.
    const on = (bucket: "noise" | "worth_knowing") => ({ bucket, enabled: true });
    expect(grown.rules).toEqual({ "both@x.com": on("worth_knowing"), "onlyprofile@x.com": on("noise") });
    expect(loadRules(storage)).toEqual({ "both@x.com": on("worth_knowing"), "onlyprofile@x.com": on("noise") });
  });

  it("says nothing changed when the profile carries nothing this device lacks", () => {
    const storage = fakeStorage();
    toggleVip("same@x.com", storage);
    mute("t1", storage);
    expect(hydrateMailFromProfile({ vips: ["same@x.com"], muted: ["t1"] }, storage)).toEqual({});
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

// UP-MIND-09: the desk store hydrates like the keyed ones. A thread set aside
// on the phone has to BE set aside on the laptop; that is the entire feature.
describe("hydrateMailFromProfile: at a desk", () => {
  it("pulls set-aside threads down and writes them to storage", () => {
    const storage = fakeStorage();
    const grown = hydrateMailFromProfile({ desk: { t9: "2026-09-08T10:00:00.000Z" } }, storage);
    expect(grown.desk).toEqual({ t9: "2026-09-08T10:00:00.000Z" });
    expect(loadDesk(storage)).toEqual({ t9: "2026-09-08T10:00:00.000Z" });
  });

  it("unions the two devices, and this device's own time for a thread wins", () => {
    const storage = fakeStorage();
    setAtDesk("t1", () => Date.parse("2026-09-08T09:00:00Z"), storage);
    const grown = hydrateMailFromProfile(
      { desk: { t1: "2026-09-01T09:00:00.000Z", t2: "2026-09-07T09:00:00.000Z" } },
      storage,
    );
    expect(grown.desk).toEqual({
      t1: "2026-09-08T09:00:00.000Z",
      t2: "2026-09-07T09:00:00.000Z",
    });
  });

  it("an empty desk in the profile changes nothing", () => {
    const storage = fakeStorage();
    expect(hydrateMailFromProfile({ desk: {} }, storage).desk).toBeUndefined();
  });
});

// E-14 (Push G): Email Windows ride the mirror only where this device said so.
import { saveWindows, loadWindows, saveWindowsMirror, DEFAULT_WINDOWS } from "./batching";
describe("windows in the mirror (opt-in)", () => {
  const custom = { on: true, windows: [{ startMin: 8 * 60, minutes: 30 }], days: [1, 3, 5] };
  it("snapshot leaves windows out unless this device opted in", () => {
    const storage = fakeStorage();
    saveWindows(custom, storage);
    expect(mailSnapshot(storage).windows).toBeUndefined();
    saveWindowsMirror(true, storage);
    expect(mailSnapshot(storage).windows).toEqual(custom);
  });
  it("hydrate ignores the field on a device that did not opt in, and takes it whole on one that did", () => {
    const storage = fakeStorage();
    expect(hydrateMailFromProfile({ windows: custom }, storage).windows).toBeUndefined();
    expect(loadWindows(storage)).toEqual(DEFAULT_WINDOWS);
    saveWindowsMirror(true, storage);
    expect(hydrateMailFromProfile({ windows: custom }, storage).windows).toEqual(custom);
    expect(loadWindows(storage)).toEqual(custom);
    // Same again: nothing changed, nothing reported.
    expect(hydrateMailFromProfile({ windows: custom }, storage).windows).toBeUndefined();
    // Junk from the profile never lands.
    expect(hydrateMailFromProfile({ windows: { on: true, windows: [], days: [] } }, storage).windows).toBeUndefined();
    expect(loadWindows(storage)).toEqual(custom);
  });
});
