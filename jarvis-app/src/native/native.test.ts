// Pins the pure logic of the native seven staging: Health workout dedupe
// (JARVIS wins), EventKit UID + title-window dedupe, and Contacts identity
// matching with its refusals. The Swift side is committed uncompiled under
// jarvis-app/native/; these tests are what keeps the logic honest until the
// bridges go live.

import { describe, it, expect } from "vitest";
import { dedupeHealthWorkouts, windowsOverlap, healthProvenance } from "./healthDedupe";
import type { HealthWorkoutRecord } from "./bridge";
import { dedupeEventKit, eventKitProvenance, START_WINDOW_MS } from "./eventKitDedupe";
import { enrichPeople, matchContact, enrichmentPatch, normalizePhone, normalizeEmail, type KnownPerson } from "./contactsMatch";
import type { DeviceContact } from "./bridge";
import { NotStagedError, healthBridge } from "./bridge";

const MIN = 60 * 1000;
const T0 = Date.parse("2026-08-15T09:00:00Z");

function workout(uid: string, startMin: number, endMin: number): HealthWorkoutRecord {
  return { uid, start: T0 + startMin * MIN, end: T0 + endMin * MIN, activityType: "traditionalStrengthTraining" };
}

describe("health dedupe: one record, JARVIS wins", () => {
  it("a workout with no overlapping native session imports", () => {
    const r = dedupeHealthWorkouts([workout("w1", 0, 60)], [{ id: "s1", start: T0 + 120 * MIN, end: T0 + 180 * MIN }]);
    expect(r.imports.map((w) => w.uid)).toEqual(["w1"]);
    expect(r.suppressed).toEqual([]);
  });

  it("a workout overlapping a native session is suppressed and the session wins", () => {
    const r = dedupeHealthWorkouts([workout("w1", 0, 60)], [{ id: "s1", start: T0 + 30 * MIN, end: T0 + 90 * MIN }]);
    expect(r.imports).toEqual([]);
    expect(r.suppressed).toHaveLength(1);
    expect(r.suppressed[0]!.keptSessionId).toBe("s1");
    expect(r.suppressed[0]!.workout.uid).toBe("w1");
  });

  it("touching endpoints is not overlap: back-to-back workouts both survive", () => {
    const session = { id: "s1", start: T0 + 60 * MIN, end: T0 + 90 * MIN };
    expect(windowsOverlap(workout("w1", 0, 60), session)).toBe(false);
    const r = dedupeHealthWorkouts([workout("w1", 0, 60)], [session]);
    expect(r.imports.map((w) => w.uid)).toEqual(["w1"]);
  });

  it("a mixed batch splits correctly", () => {
    const sessions = [{ id: "s1", start: T0, end: T0 + 45 * MIN }];
    const r = dedupeHealthWorkouts([workout("w1", 10, 40), workout("w2", 100, 130)], sessions);
    expect(r.imports.map((w) => w.uid)).toEqual(["w2"]);
    expect(r.suppressed.map((s) => s.workout.uid)).toEqual(["w1"]);
  });

  it("an imported workout carries apple_health provenance with the uid as ref", () => {
    const src = healthProvenance(workout("hk-abc", 0, 60), () => T0);
    expect(src).toEqual({ type: "apple_health", ref: "hk-abc", ts: T0 });
  });
});

describe("eventkit dedupe: uid first, then title plus start window", () => {
  const existing = [
    { id: "e1", icalUid: "uid-1", title: "Dentist", start: T0 },
    { id: "e2", title: "Team standup", start: T0 + 240 * MIN },
  ];

  it("the same iCal UID dedupes even when the start moved hours", () => {
    const r = dedupeEventKit([{ icalUid: "uid-1", title: "Dentist (moved)", start: T0 + 300 * MIN }], existing);
    expect(r.fresh).toEqual([]);
    expect(r.matched).toEqual([{ incoming: expect.objectContaining({ icalUid: "uid-1" }), existingId: "e1", by: "uid" }]);
  });

  it("no uid match but same title within 30 minutes dedupes", () => {
    const r = dedupeEventKit([{ icalUid: "uid-9", title: "Team standup", start: T0 + 240 * MIN + START_WINDOW_MS }], existing);
    expect(r.fresh).toEqual([]);
    expect(r.matched[0]).toMatchObject({ existingId: "e2", by: "title_window" });
  });

  it("same title outside the 30 minute window is a fresh event", () => {
    const r = dedupeEventKit([{ icalUid: "uid-9", title: "Team standup", start: T0 + 240 * MIN + START_WINDOW_MS + 1 }], existing);
    expect(r.matched).toEqual([]);
    expect(r.fresh).toHaveLength(1);
  });

  it("title matching ignores case and extra whitespace", () => {
    const r = dedupeEventKit([{ icalUid: "uid-9", title: "  team   STANDUP ", start: T0 + 245 * MIN }], existing);
    expect(r.matched[0]).toMatchObject({ existingId: "e2", by: "title_window" });
  });

  it("an event with no counterpart imports fresh with calendar provenance", () => {
    const item = { icalUid: "uid-7", title: "Physical therapy", start: T0 + 30 * MIN };
    const r = dedupeEventKit([item], existing);
    expect(r.fresh).toEqual([item]);
    expect(eventKitProvenance("apple_calendar", item, () => T0)).toEqual({ type: "apple_calendar", ref: "uid-7", ts: T0 });
    expect(eventKitProvenance("apple_reminders", item, () => T0).type).toBe("apple_reminders");
  });
});

describe("contacts matching: identity or nothing", () => {
  const contact = (over: Partial<DeviceContact>): DeviceContact => ({ id: "c1", phones: [], emails: [], ...over });

  it("an exact phone match fills the missing email and photo only", () => {
    const people: KnownPerson[] = [{ id: "p1", name: "Sarah", phone: "5551234567" }];
    const c = contact({ phones: ["+1 (555) 123-4567"], emails: ["sarah@example.com"], photoRef: "ph1" });
    expect(matchContact(c, people)?.id).toBe("p1");
    const patch = enrichmentPatch(c, people[0]!);
    expect(patch).toEqual({ personId: "p1", contactId: "c1", fill: { email: "sarah@example.com", photoRef: "ph1" } });
  });

  it("an exact email match fills the missing phone", () => {
    const people: KnownPerson[] = [{ id: "p1", name: "Ridgeley", email: "Ridgeley@Example.com" }];
    const c = contact({ emails: ["ridgeley@example.com"], phones: ["555-987-6543"] });
    const patches = enrichPeople([c], people);
    expect(patches).toEqual([{ personId: "p1", contactId: "c1", fill: { phone: "555-987-6543" } }]);
  });

  it("two people sharing the matching identity means no enrichment at all", () => {
    const people: KnownPerson[] = [
      { id: "p1", name: "Dave", phone: "5551234567" },
      { id: "p2", name: "Dave Jr", phone: "15551234567" },
    ];
    const c = contact({ phones: ["(555) 123-4567"], emails: ["dave@example.com"] });
    expect(matchContact(c, people)).toBeNull();
    expect(enrichPeople([c], people)).toEqual([]);
  });

  it("identity keys pointing at different people is ambiguity, not two matches", () => {
    const people: KnownPerson[] = [
      { id: "p1", name: "A", phone: "5551234567" },
      { id: "p2", name: "B", email: "b@example.com" },
    ];
    const c = contact({ phones: ["5551234567"], emails: ["b@example.com"] });
    expect(matchContact(c, people)).toBeNull();
  });

  it("a contact matching nobody creates nothing", () => {
    const people: KnownPerson[] = [{ id: "p1", name: "Sarah", phone: "5551234567" }];
    const c = contact({ id: "stranger", phones: ["5550000000"], emails: ["new@example.com"], photoRef: "ph9" });
    expect(enrichPeople([c], people)).toEqual([]);
  });

  it("existing fields are never overwritten, even when the device disagrees", () => {
    const person: KnownPerson = { id: "p1", name: "Sarah", phone: "5551234567", email: "old@example.com", photoRef: "kept" };
    const c = contact({ phones: ["5551234567"], emails: ["different@example.com"], photoRef: "ph2" });
    expect(enrichmentPatch(c, person)).toBeNull();
  });

  it("phone identity normalizes country code and formatting, email lowercases", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("5551234567");
    expect(normalizePhone("5551234567")).toBe("5551234567");
    expect(normalizePhone("911")).toBeNull();
    expect(normalizeEmail("  Sarah@Example.COM ")).toBe("sarah@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});

describe("bridge stubs refuse until staging completes", () => {
  it("a bridge method throws NotStagedError, never a silent resolve", () => {
    expect(() => healthBridge.queryWorkouts(0)).toThrow(NotStagedError);
    expect(() => healthBridge.queryWorkouts(0)).toThrow(/needs Apple Developer enrollment/);
  });
});
