import { describe, it, expect } from "vitest";
import { findInNotes, applyFindings, repairCandidates, duplicateNoteLines, cleanedNotes, cleanupCandidates } from "./repairNotes";
import type { PersonData } from "./types";

const person = (notes: string, extra: Partial<PersonData> = {}): PersonData =>
  ({ name: "Aaron Roman", group: "contacts", notes, ...extra });

describe("finding what the notes were hiding", () => {
  // The contact Dave photographed: a number in Notes, Phone blank beside it.
  it("finds a number written the way a person writes one", () => {
    expect(findInNotes(person("Cell 555-010-3311, call after 6"))).toEqual([
      { kind: "phone", value: "555-010-3311", context: "Cell 555-010-3311, call after 6" },
    ]);
    expect(findInNotes(person("(555) 010-3311"))[0]?.value).toBe("(555) 010-3311");
    expect(findInNotes(person("+1 555 010 3311"))[0]?.value).toBe("+1 555 010 3311");
    expect(findInNotes(person("5550103311"))[0]?.value).toBe("5550103311");
  });

  it("finds an address too", () => {
    const f = findInNotes(person("reaches him at aaron@roman.dev usually"));
    expect(f).toEqual([{ kind: "email", value: "aaron@roman.dev", context: "reaches him at aaron@roman.dev usually" }]);
  });

  // IT NEVER OVERWRITES: a method already on record is not a finding, in
  // either storage shape, so a second run offers nothing and a confirmed edit
  // is never undone.
  it("says nothing about a number the person already has", () => {
    expect(findInNotes(person("Cell 555-010-3311", { phone: "555-010-3311" }))).toEqual([]);
    // Written differently in the note than on the record: still the same
    // number, still not a finding.
    expect(findInNotes(person("Cell +1 (555) 010-3311", { phone: "5550103311" }))).toEqual([]);
    expect(findInNotes(person("a@b.com", { emails: [{ value: "A@B.com" }] }))).toEqual([]);
  });

  it("offers one number once, however many times the note repeats it", () => {
    expect(findInNotes(person("555-010-3311\ncell is 555-010-3311"))).toHaveLength(1);
  });

  // A NOTE IS FULL OF THINGS THAT LOOK LIKE NUMBERS. A review list that asks
  // about all of them is a list nobody reads.
  it("leaves alone the digits a note is actually full of", () => {
    expect(findInNotes(person("Met in 2019, paid 450 for the table"))).toEqual([]);
    expect(findInNotes(person("Invoice 4029183827 still open"))).toEqual([]);
    expect(findInNotes(person("Order 1234567890"))).toEqual([]);
    expect(findInNotes(person("Room 402, zip 44121"))).toEqual([]);
    expect(findInNotes(person("Confirmation 9988776655"))).toEqual([]);
  });

  it("does not read the digits inside an address as a second number", () => {
    expect(findInNotes(person("write to aaron5550103311@roman.dev"))
      .filter((f) => f.kind === "phone")).toEqual([]);
  });

  it("says nothing at all about a person with no notes", () => {
    expect(findInNotes({ notes: "" })).toEqual([]);
    expect(findInNotes({})).toEqual([]);
    expect(findInNotes(person("Nice guy. Met at the clinic."))).toEqual([]);
  });
});

describe("accepting a finding", () => {
  // THE NOTE IS KEPT. It is what the user typed, usually with the context
  // that makes the number mean something.
  it("writes the field and leaves the note exactly as written", () => {
    const d = person("Cell 555-010-3311, call after 6");
    const found = findInNotes(d);
    const patch = applyFindings(d, found);
    expect(patch.phone).toBe("555-010-3311");
    expect(patch.phones).toEqual([{ value: "555-010-3311" }]);
    expect(patch.notes).toBeUndefined(); // untouched, not blanked
  });

  it("saves the number the way it was written, not a normalized rewrite", () => {
    const d = person("+1 (555) 010-3311");
    expect(applyFindings(d, findInNotes(d)).phone).toBe("+1 (555) 010-3311");
  });

  // Nothing they confirmed is displaced, and the primary they rely on does
  // not move out from under them.
  it("adds behind what is already there, never in front of it", () => {
    const d = person("second line 555-010-9922", { phone: "555-010-3311" });
    const patch = applyFindings(d, findInNotes(d));
    expect(patch.phone).toBe("555-010-3311");
    expect(patch.phones).toEqual([{ value: "555-010-3311" }, { value: "555-010-9922" }]);
  });

  it("touches only the kind that was accepted", () => {
    const d = person("aaron@roman.dev and 555-010-3311");
    const emailOnly = findInNotes(d).filter((f) => f.kind === "email");
    const patch = applyFindings(d, emailOnly);
    expect(patch.email).toBe("aaron@roman.dev");
    expect(patch.phone).toBeUndefined();
    expect(patch.phones).toBeUndefined();
  });

  it("changes nothing when nothing was accepted", () => {
    expect(applyFindings(person("555-010-3311"), [])).toEqual({});
  });
});

describe("the review list", () => {
  it("names only the people with something to offer", () => {
    const list = repairCandidates([
      { id: "a", data: person("Cell 555-010-3311") },
      { id: "b", data: person("Nice guy") },
      { id: "c", data: person("c@d.com", { name: "Lee Ramos" }) },
    ]);
    expect(list.map((c) => c.id)).toEqual(["a", "c"]);
    expect(list[1]!.name).toBe("Lee Ramos");
    expect(list[0]!.findings[0]!.value).toBe("555-010-3311");
  });

  it("is empty when every contact is already in order, and stays silent", () => {
    expect(repairCandidates([{ id: "a", data: person("Cell 555-010-3311", { phone: "555-010-3311" }) }])).toEqual([]);
  });
});

// THE SAME NUMBER, WRITTEN TWICE (Dave 2026-09-16: "On every contact page it
// still has their number under notes as well"). The old import wrote it onto
// its own line in the notes blob; once the field holds it too, findInNotes
// goes quiet and the duplicate line has no way to leave.
describe("clearing a note line that only repeats a field", () => {
  it("removes the bare number an old import left behind", () => {
    const d = person("2035361094", { phone: "2035361094" });
    expect(duplicateNoteLines(d)).toEqual(["2035361094"]);
    expect(cleanedNotes(d)).toBe("");
  });

  it("removes it however differently the two were written", () => {
    expect(cleanedNotes(person("+1 (203) 536-1094", { phone: "2035361094" }))).toBe("");
    expect(cleanedNotes(person("LF@Example.com", { email: "lf@example.com" }))).toBe("");
  });

  it("removes a label the field already carries", () => {
    expect(cleanedNotes(person("Cell: 203-536-1094", { phone: "2035361094" }))).toBe("");
    expect(cleanedNotes(person("Mobile 2035361094", { phone: "2035361094" }))).toBe("");
  });

  it("keeps the lines around it", () => {
    const d = person("Met at the clinic\n2035361094\nAllergic to shellfish", { phone: "2035361094" });
    expect(cleanedNotes(d)).toBe("Met at the clinic\nAllergic to shellfish");
  });

  // A LINE THAT SAYS ANYTHING ELSE IS STILL SOMEONE'S OWN WORDS. Editing
  // round them to tidy a field is not a cleanup.
  it("leaves a line alone when it carries more than the number", () => {
    const d = person("Cell 203-536-1094, call after 6", { phone: "2035361094" });
    expect(duplicateNoteLines(d)).toEqual([]);
    expect(cleanedNotes(d)).toBeNull();
  });

  // A number the record does NOT have is the other feature's job: it gets
  // offered as a repair, and is never quietly deleted.
  it("never deletes a number the record does not already hold", () => {
    const d = person("2035361094", { phone: "555-010-3311" });
    expect(duplicateNoteLines(d)).toEqual([]);
    expect(cleanedNotes(d)).toBeNull();
    // It is a repair finding instead.
    expect(findInNotes(d).map((f) => f.value)).toEqual(["2035361094"]);
  });

  it("says nothing about an ordinary note", () => {
    expect(cleanedNotes(person("Met at the clinic", { phone: "2035361094" }))).toBeNull();
    expect(cleanedNotes(person("", { phone: "2035361094" }))).toBeNull();
  });

  it("names only the contacts with something to clear", () => {
    const list = cleanupCandidates([
      { id: "a", data: person("2035361094", { phone: "2035361094" }) },
      { id: "b", data: person("Met at the clinic", { phone: "2035361094" }) },
    ]);
    expect(list.map((c) => c.id)).toEqual(["a"]);
    expect(list[0]!.removed).toEqual(["2035361094"]);
    expect(list[0]!.notes).toBe("");
  });
});
