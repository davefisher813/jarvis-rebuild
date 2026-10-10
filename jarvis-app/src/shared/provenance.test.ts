import { describe, it, expect } from "vitest";
import { madeBy, sourceLabel, sourceWhen, rowSource, withInferred, confidenceOf, sourceOf, type Source } from "./provenance";
import { ENTITY_PERSON } from "../people/types";
import { BRAIN_MEMORY_ENTITY } from "../ai/brainMemory";
import { ENTITY_DECISION } from "../decisions/types";
import { ENTITY_MONEY_BILL, ENTITY_MONEY_RECEIPT } from "../money/ledger/types";
import { ENTITY_MONEY_TX } from "../money/tracker";
import { ENTITY_TASK } from "../notes/types";

// Fixed clock: 2026-08-15 14:14 local.
const NOW = new Date(2026, 7, 15, 14, 14).getTime();
const now = () => NOW;

describe("provenance", () => {
  it("madeBy stamps type, ref, and the current time", () => {
    const s = madeBy("note", "n1", now);
    expect(s).toEqual({ type: "note", ref: "n1", ts: NOW });
  });

  it("madeBy omits ref when there is none", () => {
    const s = madeBy("sweep", undefined, now);
    expect(s).toEqual({ type: "sweep", ts: NOW });
    expect("ref" in s).toBe(false);
  });

  it("same-day sources show a clock time", () => {
    const s: Source = { type: "note", ref: "n1", ts: new Date(2026, 7, 15, 9, 5).getTime() };
    expect(sourceLabel(s)).toBe("From a note");
    expect(sourceWhen(s, now)).toMatch(/9:05/);
  });

  it("older sources show a short date, not a time", () => {
    const s: Source = { type: "paste", ts: new Date(2026, 7, 12, 9, 5).getTime() };
    expect(sourceLabel(s)).toBe("From Smart Paste");
    expect(sourceWhen(s, now)).toMatch(/Aug/);
    expect(sourceWhen(s, now)).not.toMatch(/9:05/);
  });

  it("no source renders nothing, so hand-made entities stay clean", () => {
    expect(sourceLabel(undefined)).toBeNull();
    expect(sourceWhen(undefined, now)).toBeNull();
  });

  it("an unknown stored type renders nothing rather than guessing", () => {
    const mystery = { type: "mystery" as Source["type"], ts: NOW };
    expect(sourceLabel(mystery)).toBeNull();
    expect(sourceWhen(mystery, now)).toBeNull();
  });

  // §AM F3 (2026-09-26): a rendered line carries the label and the time as
  // two facts, so the time has its own half with no separator typed into it.
  it("the when half is the time or date alone, with no separator in it", () => {
    const today: Source = { type: "note", ts: new Date(2026, 7, 15, 9, 5).getTime() };
    const earlier: Source = { type: "paste", ts: new Date(2026, 7, 12, 9, 5).getTime() };
    expect(sourceWhen(today, now)).toMatch(/9:05/);
    expect(sourceWhen(earlier, now)).toMatch(/Aug/);
    for (const s of [today, earlier]) {
      expect(sourceWhen(s, now)).not.toMatch(/From|·/);
      expect(sourceLabel(s)).not.toMatch(/·/);
    }
  });

  it("the when half exists exactly where the label does", () => {
    const sweep: Source = { type: "sweep", ts: NOW };
    const mystery = { type: "mystery" as Source["type"], ts: NOW };
    for (const s of [undefined, sweep, mystery]) {
      expect(sourceLabel(s)).toBeNull();
      expect(sourceWhen(s, now)).toBeNull();
    }
  });

  // UP-CORE-05 (2026-09-05): a thing can carry both where it came from and
  // an automated move. Auto-Sweep moves are kept internal and never displayed.
  it("Auto-Sweep moves stay internal, never shown on rows", () => {
    const from: Source = { type: "paste", ts: new Date(2026, 7, 10, 9, 0).getTime() };
    const movedToday: Source = { type: "sweep", ts: new Date(2026, 7, 15, 6, 0).getTime() };
    const movedBefore: Source = { type: "sweep", ts: new Date(2026, 7, 14, 6, 0).getTime() };
    // rowSource skips sweep moves (keeps origin instead) so rows never show sweep provenance
    expect(rowSource(from, movedToday, now)).toBe(from);
    expect(rowSource(from, movedBefore, now)).toBe(from);
    expect(rowSource(from, undefined, now)).toBe(from);
    expect(rowSource(undefined, movedToday, now)).toBeUndefined();
    expect(rowSource(undefined, undefined, now)).toBeUndefined();
  });
});

// Phase 0 D3 (2026-10-10): the two new origins and the fact that stands in
// for a stored confidence word.
describe("provenance: app and import", () => {
  it("both render a sentence case line in the file's own voice", () => {
    expect(sourceLabel({ type: "app", ref: "backend-inbox:inbox_1", ts: NOW })).toBe("From another app");
    expect(sourceLabel({ type: "import", ts: NOW })).toBe("From an import");
  });
});

describe("withInferred: the fields a rule guessed, recorded on the stamp", () => {
  it("records the fields when there are any", () => {
    const s = withInferred(madeBy("paste", undefined, now), ["personId"]);
    expect(s).toEqual({ type: "paste", ts: NOW, inferred: ["personId"] });
  });

  it("an empty list leaves the stamp byte identical, so madeBy('paste') assertions hold", () => {
    const base = madeBy("paste", undefined, now);
    expect(withInferred(base, [])).toBe(base);
    expect("inferred" in withInferred(base, [])).toBe(false);
  });
});

describe("confidenceOf: a derived word, never a stored one", () => {
  it("a stamp with guessed fields is inferred, whatever its type", () => {
    expect(confidenceOf({ type: "paste", ts: NOW, inferred: ["personId"] })).toBe("inferred");
    expect(confidenceOf({ type: "app", ts: NOW, inferred: ["projectId"] })).toBe("inferred");
  });

  it("a stamp from outside the app is imported", () => {
    for (const type of ["app", "import", "google_calendar", "contacts", "gmail", "apple_calendar", "apple_reminders", "apple_health"] as const) {
      expect(confidenceOf({ type, ts: NOW })).toBe("imported");
    }
  });

  it("everything else is stated, and an empty inferred list does not change that", () => {
    for (const type of ["paste", "note", "email", "recorder", "chat", "file", "plan", "event", "task", "sweep", "reflow", "health"] as const) {
      expect(confidenceOf({ type, ts: NOW })).toBe("stated");
    }
    expect(confidenceOf({ type: "paste", ts: NOW, inferred: [] })).toBe("stated");
  });
});

describe("sourceOf: every module's own shape read into one Source", () => {
  const AT = "2026-08-12T09:05:00.000Z";

  it("a person's source enum: outside origins map, a hand added person has none", () => {
    expect(sourceOf(ENTITY_PERSON, { name: "A", source: "import" })).toEqual({ type: "import", ts: 0 });
    expect(sourceOf(ENTITY_PERSON, { name: "A", source: "email" })).toEqual({ type: "email", ts: 0 });
    expect(sourceOf(ENTITY_PERSON, { name: "A", source: "calendar" })).toEqual({ type: "event", ts: 0 });
    expect(sourceOf(ENTITY_PERSON, { name: "A", source: "event" })).toEqual({ type: "event", ts: 0 });
    expect(sourceOf(ENTITY_PERSON, { name: "A", source: "manual" })).toBeUndefined();
    // The bulk imported rows carry only sourceUid: no backfill (Dave 2026-09-28).
    expect(sourceOf(ENTITY_PERSON, { name: "A", sourceUid: "x" })).toBeUndefined();
  });

  it("a brain memory's source: a filing made from a record maps, a filing by hand has none", () => {
    expect(sourceOf(BRAIN_MEMORY_ENTITY, { source: "manual-chat" })).toEqual({ type: "chat", ts: 0 });
    expect(sourceOf(BRAIN_MEMORY_ENTITY, { source: "note" })).toEqual({ type: "note", ts: 0 });
    expect(sourceOf(BRAIN_MEMORY_ENTITY, { source: "email" })).toEqual({ type: "email", ts: 0 });
    expect(sourceOf(BRAIN_MEMORY_ENTITY, { source: "task" })).toEqual({ type: "task", ts: 0 });
    expect(sourceOf(BRAIN_MEMORY_ENTITY, { source: "event" })).toEqual({ type: "event", ts: 0 });
    expect(sourceOf(BRAIN_MEMORY_ENTITY, { source: "plus-menu" })).toBeUndefined();
    expect(sourceOf(BRAIN_MEMORY_ENTITY, { source: "brain" })).toBeUndefined();
  });

  it("a decision's {kind, entityId, at} carries its ref and its when", () => {
    expect(sourceOf(ENTITY_DECISION, { source: { kind: "note", entityId: "n1", at: AT } }))
      .toEqual({ type: "note", ref: "n1", ts: Date.parse(AT) });
    expect(sourceOf(ENTITY_DECISION, { source: { kind: "chat", at: AT } })).toEqual({ type: "chat", ts: Date.parse(AT) });
    expect(sourceOf(ENTITY_DECISION, { source: { kind: "email", entityId: "t1", at: AT } })).toMatchObject({ type: "email", ref: "t1" });
    expect(sourceOf(ENTITY_DECISION, { source: { kind: "manual", at: AT } })).toBeUndefined();
    expect(sourceOf(ENTITY_DECISION, {})).toBeUndefined();
  });

  it("a bill or receipt born of an email: the way BillDetailSheet mapped it by hand", () => {
    const data = { source: { type: "email", fingerprint: "f", ref: "thread-1" }, history: [{ at: AT, by: "email", action: "created" }] };
    expect(sourceOf(ENTITY_MONEY_BILL, data)).toEqual({ type: "email", ref: "thread-1", ts: Date.parse(AT) });
    expect(sourceOf(ENTITY_MONEY_RECEIPT, data)).toEqual({ type: "email", ref: "thread-1", ts: Date.parse(AT) });
    // No ref on the email source: no ref on the stamp, so there is no door.
    expect(sourceOf(ENTITY_MONEY_BILL, { source: { type: "email", fingerprint: "f" }, history: [{ at: AT }] }))
      .toEqual({ type: "email", ts: Date.parse(AT) });
    // No history: ts 0, the sheet's own fallback.
    expect(sourceOf(ENTITY_MONEY_BILL, { source: { type: "email", fingerprint: "f" }, history: [] })!.ts).toBe(0);
  });

  it("a hand entered bill, a photographed receipt: the person made them, no source", () => {
    expect(sourceOf(ENTITY_MONEY_BILL, { source: "manual", history: [{ at: AT }] })).toBeUndefined();
    expect(sourceOf(ENTITY_MONEY_RECEIPT, { source: "camera", history: [{ at: AT }] })).toBeUndefined();
  });

  it("an imported transaction is an import; a pre ledger row with no source has none", () => {
    expect(sourceOf(ENTITY_MONEY_TX, { source: "import", history: [{ at: AT }] })).toEqual({ type: "import", ts: Date.parse(AT) });
    expect(sourceOf(ENTITY_MONEY_TX, { source: "import" })).toEqual({ type: "import", ts: 0 });
    expect(sourceOf(ENTITY_MONEY_TX, { source: "manual" })).toBeUndefined();
    expect(sourceOf(ENTITY_MONEY_TX, { amountCents: 100 })).toBeUndefined();
  });

  it("a kind whose source is already a Source comes back as is, inferred and all", () => {
    const stamp: Source = { type: "paste", ref: "p1", ts: NOW, inferred: ["personId"] };
    expect(sourceOf(ENTITY_TASK, { text: "x", source: stamp })).toBe(stamp);
    expect(sourceOf("event", { title: "x", source: { type: "google_calendar", ref: "g1", ts: NOW } }))
      .toEqual({ type: "google_calendar", ref: "g1", ts: NOW });
  });

  it("nothing, a hand made row, or a shape it does not recognise answers undefined rather than guessing", () => {
    expect(sourceOf(ENTITY_TASK, { text: "x" })).toBeUndefined();
    expect(sourceOf(ENTITY_TASK, { text: "x", source: "paste" })).toBeUndefined();
    expect(sourceOf(ENTITY_TASK, null)).toBeUndefined();
    expect(sourceOf(ENTITY_PERSON, { source: 7 })).toBeUndefined();
  });
});
