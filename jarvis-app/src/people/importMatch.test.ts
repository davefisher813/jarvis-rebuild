import { describe, it, expect } from "vitest";
import { planImport, mergeReview, draftFrom, planLine, summaryLine, describe as describePerson } from "./importMatch";
import type { ImportedContact } from "./importContacts";
import type { Person } from "./types";

const p = (id: string, data: Partial<Person["data"]> & { name: string }): Person =>
  ({ id, data: { group: "contacts", ...data } });

describe("the import ladder", () => {
  // RUNG 1: the source's own id. Nothing is more certain, and it is the only
  // rung that does not depend on the data being right.
  it("recognizes someone by the id the file gave them, whatever the name says", () => {
    const existing = [p("a", { name: "Linda F.", sourceUid: "uid-linda" })];
    const plan = planImport(existing, [{ name: "Linda Fisher", uid: "uid-linda", phone: "555-0111" }]);
    expect(plan.create).toEqual([]);
    expect(plan.review).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.person.id).toBe("a");
  });

  // RUNG 2: a shared address or number, normalized for comparison only.
  it("recognizes someone by a number written differently in each file", () => {
    const existing = [p("a", { name: "Linda Fisher", phone: "+1 (555) 010-3311" })];
    const plan = planImport(existing, [{ name: "L. Fisher", phone: "5550103311", email: "lf@example.com" }]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]!.changes).toEqual(["an email address"]);
  });

  // A household landline is shared by everyone who lives there, so it is
  // evidence and not proof. Ambiguous evidence is no evidence.
  it("does not treat a number two people share as an identity", () => {
    const existing = [
      p("a", { name: "Linda Fisher", phone: "555-010-9922" }),
      p("b", { name: "Ray Fisher", phone: "555-010-9922" }),
    ];
    const plan = planImport(existing, [{ name: "Nina Fisher", phone: "555-010-9922" }]);
    expect(plan.update).toEqual([]);
    expect(plan.create.map((c) => c.name)).toEqual(["Nina Fisher"]);
  });

  // RUNG 3: a name alone is not a match. The old code SKIPPED these, which
  // lost a real person silently.
  it("sends a same-name stranger to review instead of dropping them", () => {
    const existing = [p("a", { name: "John Smith", phone: "555-0100" })];
    const plan = planImport(existing, [{ name: "John Smith", phone: "555-0999" }]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.review).toHaveLength(1);
    expect(plan.review[0]!.candidates.map((c) => c.id)).toEqual(["a"]);
    expect(plan.review[0]!.reason).toBe("same-name");
  });

  it("matches an alias to review too, since that is a name you use for them", () => {
    const existing = [p("a", { name: "Linda Fisher", aliases: ["Mom"] })];
    expect(planImport(existing, [{ name: "Mom" }]).review).toHaveLength(1);
  });

  it("creates someone the app has never seen", () => {
    const plan = planImport([], [{ name: "Byron Valverde", phone: "555-0123" }]);
    expect(plan.create.map((c) => c.name)).toEqual(["Byron Valverde"]);
    expect(plan.update).toEqual([]);
    expect(plan.review).toEqual([]);
  });
});

describe("what an update is allowed to do", () => {
  const stale: ImportedContact = {
    name: "Linda Fisher", uid: "uid-linda",
    phone: "555-0111", phones: [{ value: "555-0111" }],
    notes: "whatever the phone had", birthday: "1960-04-20",
  };

  // A reimport of a stale export must not be able to walk back a correction
  // made by hand.
  it("never replaces what is already on the record", () => {
    const existing = [p("a", {
      name: "Linda Fisher", sourceUid: "uid-linda",
      phone: "555-0111", notes: "My own note, which I wrote", birthday: "1961-04-20",
    })];
    const plan = planImport(existing, [stale]);
    // Nothing new: the note and birthday it carries are both already answered.
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("fills a field the record left empty", () => {
    const existing = [p("a", { name: "Linda Fisher", sourceUid: "uid-linda", phone: "555-0111" })];
    const plan = planImport(existing, [stale]);
    const u = plan.update[0]!;
    expect(u.patch.notes).toBe("whatever the phone had");
    expect(u.patch.birthday).toBe("1960-04-20");
    expect(u.changes).toEqual(["a birthday", "a note"]);
  });

  it("adds a number it did not have and keeps the primary where it was", () => {
    const existing = [p("a", { name: "Linda Fisher", sourceUid: "uid-linda", phone: "555-0111" })];
    const plan = planImport(existing, [{
      name: "Linda Fisher", uid: "uid-linda",
      phones: [{ value: "555-0111" }, { value: "555-0999", label: "work" }],
    }]);
    const u = plan.update[0]!;
    expect(u.patch.phone).toBe("555-0111");
    expect(u.patch.phones).toEqual([{ value: "555-0111" }, { value: "555-0999", label: "work" }]);
    expect(u.changes).toEqual(["a phone number"]);
  });

  it("learns the source id even when nothing else changed", () => {
    const existing = [p("a", { name: "Linda Fisher", phone: "555-0111" })];
    const plan = planImport(existing, [{ name: "Linda Fisher", uid: "uid-linda", phone: "555-0111" }]);
    expect(plan.update[0]!.patch.sourceUid).toBe("uid-linda");
    expect(plan.update[0]!.changes).toEqual(["a source id"]);
  });

  // Confirming by hand and matching by id must land on identical data.
  it("accepts a review with the same merge an automatic match would make", () => {
    const person = p("a", { name: "John Smith", phone: "555-0100" });
    const patch = mergeReview(person, { name: "John Smith", phone: "555-0999", email: "js@example.com" });
    expect(patch.phones).toEqual([{ value: "555-0100" }, { value: "555-0999" }]);
    expect(patch.email).toBe("js@example.com");
  });
});

describe("a contact becoming a person", () => {
  it("carries everything the file gave it, source id included", () => {
    const d = draftFrom({
      name: "Linda Fisher", uid: "uid-linda", org: "Cedar Bridge Club", title: "Secretary",
      phone: "555-0111", phones: [{ value: "555-0111", label: "mobile" }],
      addresses: ["1 Vine St, Cedar, OH 44121, USA"], urls: ["https://x.org"],
    });
    expect(d.sourceUid).toBe("uid-linda");
    expect(d.org).toBe("Cedar Bridge Club");
    expect(d.title).toBe("Secretary");
    expect(d.phones).toEqual([{ value: "555-0111", label: "mobile" }]);
    expect(d.addresses).toEqual(["1 Vine St, Cedar, OH 44121, USA"]);
    expect(d.group).toBe("contacts");
  });

  it("writes no empty fields for a card that carried only a name", () => {
    expect(draftFrom({ name: "Plain Person" })).toEqual({ name: "Plain Person", group: "contacts" });
  });
});

// THE SUMMARY SAYS ALL FOUR THINGS (People handoff: "Show added, updated,
// skipped, conflicts, and failures"). The old preview could only say "found"
// and "skipping", because skipping was all it did.
describe("what the preview and the receipt say", () => {
  const plan = (o: Partial<Parameters<typeof planLine>[0]> = {}) => ({
    create: [], update: [], unchanged: 0, review: [], ...o,
  }) as Parameters<typeof planLine>[0];

  it("counts each pile separately", () => {
    const l = planLine(plan({
      create: [{ name: "A" }, { name: "B" }],
      update: [{ person: p("x", { name: "X" }), contact: { name: "X" }, patch: {}, changes: ["a phone number"] }],
      unchanged: 5,
    }), 0);
    expect(l).toBe("2 New · 1 To update · 5 Already current");
  });

  // A row waiting on an answer is NOT a skipped row, and saying so would be
  // the lie the old preview told.
  it("calls an unanswered row something to check, never something skipped", () => {
    const withReview = plan({ review: [{ contact: { name: "John Smith" }, candidates: [], reason: "same-name" as const }] });
    expect(planLine(withReview, 0)).toBe("1 To check");
    // Once answered it stops being counted as waiting.
    expect(planLine(withReview, 1)).toBe("Nothing to change");
  });

  it("says plainly when a file would change nothing", () => {
    expect(planLine(plan(), 0)).toBe("Nothing to change");
    expect(summaryLine(0, 0, 0)).toBe("Nothing changed");
  });

  it("reports only what actually happened", () => {
    expect(summaryLine(3, 2, 10)).toBe("3 Added · 2 Updated · 10 Already current");
    expect(summaryLine(1, 0, 0)).toBe("1 Added");
  });

  // One line of evidence for telling two same-name people apart.
  it("describes a candidate by what it already knows about them", () => {
    expect(describePerson(p("a", { name: "John Smith", relationship: "Client", phone: "555-0100" })))
      .toBe("Client · 555-0100");
    expect(describePerson(p("b", { name: "John Smith" }))).toBe("Nothing else on file");
  });
});
