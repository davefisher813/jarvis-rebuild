import { describe, it, expect } from "vitest";
import { derivePeopleRhythm, deriveGoneQuiet, personHandled, MIN_PERSON_HANDLED, QUIET_MS, type DerivePerson } from "./derive";
import type { WindowRow } from "./window";

// UP-MIND-16. A card that reads NO LABEL YET for everyone is a Brain that
// cannot rank a sister above a stranger. These pin the gates, the label it
// proposes, and the two things it refuses to do: infer a relationship, and
// write anything without the tap.

const row = (entity_id: string | null, day: string): WindowRow =>
  ({ type: "email.handled", day, h: 10, category: null, n: null, flag: null, kind: "reply", entity_id });

const handled = (id: string, n: number) =>
  Array.from({ length: n }, (_, i) => row(id, "2026-08-" + String(1 + (i % 28)).padStart(2, "0")));

const marco: DerivePerson = { id: "p1", name: "Marco Silva" };

describe("people rhythm", () => {
  it("counts handled mail per person and ignores rows with nobody on them", () => {
    const map = personHandled([...handled("p1", 3), row(null, "2026-08-01")]);
    expect(map.get("p1")).toHaveLength(3);
    expect(map.size).toBe(1);
  });

  it("stays silent below the gate", () => {
    expect(derivePeopleRhythm(handled("p1", MIN_PERSON_HANDLED - 1), [marco])).toBeNull();
  });

  it("proposes Frequent for steady traffic, and the accept writes the label", () => {
    const d = derivePeopleRhythm(handled("p1", 12), [marco])!;
    expect(d.derivation).toBe("people_rhythm");
    expect(d.title).toBe("Marco Silva is someone you deal with constantly");
    expect(d.apply).toEqual({ kind: "person_label", personId: "p1", label: "Frequent" });
  });

  it("proposes Work when the threads are linked to a live project", () => {
    const d = derivePeopleRhythm(handled("p1", 12), [{ ...marco, onProject: true }])!;
    expect(d.apply?.label).toBe("Work");
  });

  // Somebody the user has already labelled needs no proposal, and a person
  // the app cannot name has nothing showable to say.
  it("says nothing about someone already labelled, or about a stranger", () => {
    expect(derivePeopleRhythm(handled("p1", 12), [{ ...marco, label: "Client" }])).toBeNull();
    expect(derivePeopleRhythm(handled("p9", 12), [marco])).toBeNull();
  });

  it("carries receipts, and never a count of anything about the person", () => {
    const d = derivePeopleRhythm(handled("p1", 12), [marco])!;
    expect(d.evidence.length).toBeGreaterThan(0);
    expect(d.strandText).not.toMatch(/\d/);
  });
});

describe("gone quiet", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  const labelled = (over: Partial<DerivePerson> = {}): DerivePerson =>
    ({ id: "p1", name: "Marco Silva", label: "Client", lastMs: now - 45 * 86400000, ...over });

  it("speaks only about someone the user said matters", () => {
    expect(deriveGoneQuiet([labelled()], now)).not.toBeNull();
    expect(deriveGoneQuiet([labelled({ label: undefined })], now)).toBeNull();
  });

  it("says nothing while they are still in touch", () => {
    expect(deriveGoneQuiet([labelled({ lastMs: now - 3 * 86400000 })], now)).toBeNull();
    expect(QUIET_MS).toBe(30 * 86400000);
  });

  // Unknown is not quiet. A person the app has never looked up must not be
  // reported as having gone silent.
  it("treats an unknown last contact as unknown, never as quiet", () => {
    expect(deriveGoneQuiet([labelled({ lastMs: undefined })], now)).toBeNull();
    expect(deriveGoneQuiet([labelled({ lastMs: 0 })], now)).toBeNull();
  });

  it("states the gap without reproaching anyone, and proposes no label", () => {
    const d = deriveGoneQuiet([labelled()], now)!;
    expect(d.title).toBe("Marco Silva has gone quiet");
    expect(d.sub).toBe("6 Weeks since either of you wrote");
    expect(d.apply).toBeUndefined();
  });
});
