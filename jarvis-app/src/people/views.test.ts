import { describe, it, expect } from "vitest";
import { isInnerCircle, isAdversarial, needsAdversarialReview, inView, searchPeople, extractEmailFromNotes } from "./views";
import type { Person, PersonGroup } from "./types";

// The views replaced the exclusive-bucket group model. These pin the two
// migration rules that carry consent weight: legacy Inner Circle migrates
// SILENTLY (faithful to what the user meant), legacy Adversarial NEVER
// auto-flags (the flag now changes how the app writes to a real person).

const person = (over: Partial<Person["data"]> & { group?: PersonGroup } = {}): Person =>
  ({ id: "p", data: { name: "Mike Torres", group: "contacts", ...over } }) as Person;

describe("inner circle view", () => {
  it("is everyone marked casual, regardless of legacy group", () => {
    expect(isInnerCircle(person({ register: "casual" }))).toBe(true);
    expect(isInnerCircle(person({ register: "casual", group: "adversarial" }))).toBe(true);
    expect(isInnerCircle(person({ register: "professional", group: "inner_circle" }))).toBe(false);
  });
  it("includes legacy inner_circle members whose register was never set", () => {
    expect(isInnerCircle(person({ group: "inner_circle" }))).toBe(true);
    expect(isInnerCircle(person({ group: "contacts" }))).toBe(false);
  });
});

describe("adversarial view + consent", () => {
  it("legacy adversarial members appear but are PENDING REVIEW, never auto-flagged", () => {
    const legacy = person({ group: "adversarial" });
    expect(isAdversarial(legacy)).toBe(true);
    expect(needsAdversarialReview(legacy)).toBe(true);
    expect(legacy.data.flagged).toBeUndefined();
  });
  it("confirmed and cleared states both stop the review", () => {
    expect(needsAdversarialReview(person({ group: "adversarial", flagged: true }))).toBe(false);
    expect(needsAdversarialReview(person({ group: "adversarial", flagged: false }))).toBe(false);
    expect(isAdversarial(person({ group: "adversarial", flagged: false }))).toBe(false);
    expect(isAdversarial(person({ flagged: true }))).toBe(true);
  });
  it("a person can be close AND difficult: both views at once", () => {
    const both = person({ register: "casual", flagged: true });
    expect(inView("inner_circle", both)).toBe(true);
    expect(inView("adversarial", both)).toBe(true);
    expect(inView("contacts", both)).toBe(true);
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
