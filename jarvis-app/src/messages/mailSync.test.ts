import { describe, it, expect } from "vitest";
import { mailSnapshot, hydrateMailFromProfile } from "./mailSync";
import { loadVips, toggleVip, VIP_MAX } from "./vip";
import { loadRules, saveRule } from "./rules";
import { loadMuted, mute } from "./mute";
import { loadLetGo, letGo } from "./letGo";
import { loadLinks, linkThread } from "./threadLink";

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
  // EMAIL-F-19 (2026-09-05): five stores now. Project links were the one
  // thing JARVIS learned about his mail that never left the device, so a
  // thread filed on the phone was unfiled everywhere else.
  it("is exactly what the five stores hold, nothing more", () => {
    const storage = fakeStorage();
    toggleVip("ridgeley@x.com", storage);
    saveRule("promo@x.com", "noise", storage);
    mute("t1", storage);
    letGo("t2", storage);
    linkThread("t3", { type: "project", id: "p1", label: "Ridgeley", subject: "The waiver" }, storage);
    expect(mailSnapshot(storage)).toEqual({
      vips: ["ridgeley@x.com"],
      rules: { "promo@x.com": "noise" },
      muted: ["t1"],
      letGo: ["t2"],
      links: { t3: { type: "project", id: "p1", label: "Ridgeley", subject: "The waiver" } },
    });
  });

  it("empty stores snapshot to empty, not missing", () => {
    const storage = fakeStorage();
    expect(mailSnapshot(storage)).toEqual({ vips: [], rules: {}, muted: [], letGo: [], links: {} });
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
    const grown = hydrateMailFromProfile(
      { rules: { "both@x.com": "noise", "onlyprofile@x.com": "noise" } },
      storage,
    );
    // The sender this device just filed keeps this device's answer; the one
    // it has never seen arrives.
    expect(grown.rules).toEqual({ "both@x.com": "worth_knowing", "onlyprofile@x.com": "noise" });
    expect(loadRules(storage)).toEqual({ "both@x.com": "worth_knowing", "onlyprofile@x.com": "noise" });
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
