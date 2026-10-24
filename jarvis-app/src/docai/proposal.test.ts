import { describe, expect, it } from "vitest";
import type { ExtractionResult, VerifiedField } from "./types";
import {
  alreadyDismissed, approveAllSolid, buildProposal, decide, editField, hasContent, readyToFile, resolveConflict, solidPending, uncertainPending,
  unresolvedConflicts, fingerprintOf, destinationFor,
} from "./proposal";

const f = (key: string, value: string, tier: "solid" | "uncertain" | "dropped" = "solid", reasons: string[] = []): VerifiedField => ({
  key, value, quote: value, page: 1, basis: "stated", tier, reasons, offsets: { start: 0, end: value.length },
});

const bill = (fields: VerifiedField[], conflicts: ExtractionResult["conflicts"] = []): ExtractionResult => ({
  kind: "bill", actionable: true, items: [{ group: "bill", fields }], conflicts, missingPages: [], droppedCount: 0,
});

const mk = (x: ExtractionResult) => buildProposal({ fileId: "f1", fileName: "power.pdf", title: "Power Bill", extraction: x });

describe("proposal: Approve All can never take an uncertain field (law 1)", () => {
  const p = mk(bill([f("payee", "City Power"), f("amount", "$84.20"), f("dueDate", "Nov 3, 2026", "uncertain", ["The year is not printed"])]));

  it("counts solid and uncertain apart", () => {
    expect(solidPending(p)).toBe(2);
    expect(uncertainPending(p)).toBe(1);
  });

  it("Approve All keeps solid fields and leaves the uncertain one undecided", () => {
    const q = approveAllSolid(p);
    const by = Object.fromEntries(q.groups[0]!.fields.map((x) => [x.key, x.decision]));
    expect(by).toEqual({ payee: "keep", amount: "keep", dueDate: "undecided" });
  });

  it("does not reach an uncertain field even when every field is uncertain", () => {
    const q = approveAllSolid(mk(bill([f("payee", "X", "uncertain", ["r"]), f("amount", "$1.00", "uncertain", ["r"])])));
    expect(q.groups[0]!.fields.every((x) => x.decision === "undecided")).toBe(true);
  });

  it("does not undo a drop", () => {
    const id = p.groups[0]!.fields[0]!.id;
    const q = approveAllSolid(decide(p, id, "drop"));
    expect(q.groups[0]!.fields[0]!.decision).toBe("drop");
  });

  it("keeps the uncertain reason and quote on the field", () => {
    const u = p.groups[0]!.fields.find((x) => x.key === "dueDate")!;
    expect(u.reasons).toEqual(["The year is not printed"]);
    expect(u.quote).toBe("Nov 3, 2026");
  });

  it("never carries a dropped field into the proposal", () => {
    const q = mk(bill([f("payee", "A"), f("amount", "$9.00", "dropped", ["no quote"])]));
    expect(q.groups[0]!.fields.map((x) => x.key)).toEqual(["payee"]);
  });
});

describe("proposal: deciding and editing", () => {
  const p = mk(bill([f("payee", "City Power"), f("amount", "$84.20"), f("dueDate", "Nov 3", "uncertain", ["no year"])]));

  it("keeps an undecided uncertain field out of what gets filed", () => {
    const q = approveAllSolid(p);
    expect(readyToFile(q)).toBe(true);
    expect(q.groups[0]!.fields.find((x) => x.key === "dueDate")!.decision).toBe("undecided");
  });

  it("an edit is kept, solid, and marked as his", () => {
    const id = p.groups[0]!.fields.find((x) => x.key === "dueDate")!.id;
    const q = editField(p, id, " 2026-11-03 ");
    const e = q.groups[0]!.fields.find((x) => x.id === id)!;
    expect(e).toMatchObject({ value: "2026-11-03", decision: "keep", tier: "solid", byUser: true });
    expect(e.reasons).toEqual([]);
  });

  it("clearing an edit drops the field", () => {
    const id = p.groups[0]!.fields[0]!.id;
    expect(editField(p, id, "  ").groups[0]!.fields[0]!.decision).toBe("drop");
  });

  it("is not ready with nothing kept", () => {
    expect(readyToFile(p)).toBe(false);
  });

  it("is not ready once it is no longer open", () => {
    expect(readyToFile({ ...approveAllSolid(p), status: "filed" })).toBe(false);
    expect(readyToFile({ ...approveAllSolid(p), status: "dismissed" })).toBe(false);
  });
});

describe("proposal: conflicts keep neither side until Dave picks", () => {
  const conflict = { key: "amount", group: "bill", candidates: [{ value: "$84.20", quote: "Total $84.20", page: 1 }, { value: "$48.20", quote: "Amount due $48.20", page: 2 }] };
  const p = approveAllSolid(mk(bill([f("payee", "City Power")], [conflict])));

  it("shows both values and blocks filing", () => {
    expect(p.conflicts[0]!.candidates).toHaveLength(2);
    expect(unresolvedConflicts(p)).toBe(1);
    expect(readyToFile(p)).toBe(false);
    expect(p.groups[0]!.fields.some((x) => x.key === "amount")).toBe(false);
  });

  it("choosing a side adds that value as his kept field", () => {
    const q = resolveConflict(p, p.conflicts[0]!.id, 1);
    const amt = q.groups[0]!.fields.find((x) => x.key === "amount")!;
    expect(amt).toMatchObject({ value: "$48.20", decision: "keep", byUser: true });
    expect(unresolvedConflicts(q)).toBe(0);
    expect(readyToFile(q)).toBe(true);
  });

  it("changing his mind replaces the pick, never doubles it", () => {
    const a = resolveConflict(p, p.conflicts[0]!.id, 0);
    const b = resolveConflict(a, a.conflicts[0]!.id, 1);
    expect(b.groups[0]!.fields.filter((x) => x.key === "amount")).toHaveLength(1);
    expect(b.groups[0]!.fields.find((x) => x.key === "amount")!.value).toBe("$48.20");
  });

  it("dropping the conflict resolves it with nothing filed for that field", () => {
    const q = resolveConflict(p, p.conflicts[0]!.id, "drop");
    expect(unresolvedConflicts(q)).toBe(0);
    expect(q.groups[0]!.fields.some((x) => x.key === "amount")).toBe(false);
  });

  it("an unknown conflict id or candidate changes nothing", () => {
    expect(resolveConflict(p, "nope", 0)).toBe(p);
    expect(resolveConflict(p, p.conflicts[0]!.id, 9)).toBe(p);
  });
});

describe("proposal: shape, destination and dismissal", () => {
  it("routes a kind to its door, and anything else to a note", () => {
    expect(destinationFor("bill")).toBe("money");
    expect(destinationFor("schedule")).toBe("calendar");
    expect(destinationFor("general")).toBe("note");
    expect(destinationFor("letter")).toBe("note");
  });

  it("names the kind and the destination in plain words", () => {
    const p = mk(bill([f("payee", "A"), f("amount", "$1.00")]));
    expect(p.kindWords).toBe("Looks Like a Bill");
    expect(p.destinationWords).toBe("Bill in Money");
    expect(p.status).toBe("open");
  });

  it("has no content when nothing survived", () => {
    expect(hasContent(mk(bill([f("amount", "$1", "dropped", ["x"])])))).toBe(false);
  });

  it("the same extraction has the same fingerprint, a different one does not", () => {
    const a = mk(bill([f("payee", "City Power"), f("amount", "$84.20")]));
    const b = mk(bill([f("amount", "$84.20"), f("payee", "city power ")]));
    const c = mk(bill([f("payee", "City Power"), f("amount", "$85.20")]));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(fingerprintOf("other", "bill", a.groups)).not.toBe(a.fingerprint);
  });

  it("a dismissed fingerprint is recognized and never proposed again", () => {
    const a = mk(bill([f("payee", "City Power"), f("amount", "$84.20")]));
    expect(alreadyDismissed(a.fingerprint, [a.fingerprint])).toBe(true);
    expect(alreadyDismissed(a.fingerprint, ["other"])).toBe(false);
  });

  it("titles each event on a schedule by its own title", () => {
    const x: ExtractionResult = {
      kind: "schedule", actionable: true, conflicts: [], missingPages: [2], droppedCount: 0,
      items: [{ group: "e1", fields: [f("title", "Practice"), f("date", "2026-11-02")] }, { group: "e2", fields: [f("date", "2026-11-03")] }],
    };
    const p = mk(x);
    expect(p.groups.map((g) => g.label)).toEqual(["Practice", "Event 2"]);
    expect(p.missingPages).toEqual([2]);
  });
});
