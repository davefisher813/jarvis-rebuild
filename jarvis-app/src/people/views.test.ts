import { describe, it, expect } from "vitest";
import { needsAdversarialReview, searchPeople, extractEmailFromNotes } from "./views";
import type { Person, PersonGroup } from "./types";

// The Inner Circle / Adversarial lists are gone (2026-08-03); what remains
// carries the consent weight: a legacy adversarial-group member is NEVER
// auto-flagged, because the flag changes how the app writes to a real person.

const person = (over: Partial<Person["data"]> & { group?: PersonGroup } = {}): Person =>
  ({ id: "p", data: { name: "Mike Torres", group: "contacts", ...over } }) as Person;

describe("adversarial legacy consent", () => {
  it("legacy adversarial members are PENDING REVIEW, never auto-flagged", () => {
    const legacy = person({ group: "adversarial" });
    expect(needsAdversarialReview(legacy)).toBe(true);
    expect(legacy.data.flagged).toBeUndefined();
  });
  it("confirmed and cleared states both stop the review; non-legacy never start it", () => {
    expect(needsAdversarialReview(person({ group: "adversarial", flagged: true }))).toBe(false);
    expect(needsAdversarialReview(person({ group: "adversarial", flagged: false }))).toBe(false);
    expect(needsAdversarialReview(person({ group: "contacts" }))).toBe(false);
    expect(needsAdversarialReview(person({ group: "inner_circle" }))).toBe(false);
  });
});

describe("searchPeople", () => {
  const ppl = [person({ name: "Mike Torres", relationship: "Brother-in-law" }), person({ name: "Ana Diaz" })];
  it("matches name and label, case-insensitive; empty query returns all", () => {
    expect(searchPeople(ppl, "mik")).toHaveLength(1);
    expect(searchPeople(ppl, "BROTHER")).toHaveLength(1);
    expect(searchPeople(ppl, "  ")).toHaveLength(2);
    expect(searchPeople(ppl, "zzz")).toHaveLength(0);
  });
});

describe("extractEmailFromNotes", () => {
  it("lifts exactly one email-shaped token; ambiguity extracts nothing", () => {
    expect(extractEmailFromNotes("mobile 555-0100\nmike@torres.com")).toBe("mike@torres.com");
    expect(extractEmailFromNotes("a@b.com and old c@d.com")).toBeNull();
    expect(extractEmailFromNotes("no contact info")).toBeNull();
    expect(extractEmailFromNotes(undefined)).toBeNull();
    // the same address twice is still one address
    expect(extractEmailFromNotes("mike@torres.com (work) mike@torres.com")).toBe("mike@torres.com");
  });
});
