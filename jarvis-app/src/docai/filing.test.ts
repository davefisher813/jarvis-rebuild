import { describe, expect, it, vi } from "vitest";
import type { ExtractionResult, VerifiedField } from "./types";
import { approveAllSolid, buildProposal, decide, resolveConflict } from "./proposal";
import { filedWords, fileProposal, type FilingDoors } from "./filing";

const f = (key: string, value: string, tier: "solid" | "uncertain" = "solid"): VerifiedField => ({
  key, value, quote: value, page: 1, basis: "stated", tier, reasons: tier === "uncertain" ? ["unsure"] : [], offsets: null,
});
const make = (kind: ExtractionResult["kind"], items: VerifiedField[][], conflicts: ExtractionResult["conflicts"] = []) =>
  buildProposal({
    fileId: "file1", fileName: "doc.pdf", title: "Doc",
    extraction: { kind, actionable: true, items: items.map((fields, i) => ({ group: "g" + i, fields })), conflicts, missingPages: [], droppedCount: 0 },
  });

const doors = (over: Partial<FilingDoors> = {}): FilingDoors & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    addBill: vi.fn(async (i) => { calls.push("bill:" + i.vendor + ":" + i.amount); return { ok: true as const, id: "b1", duplicate: false }; }),
    createEvent: vi.fn(async (t) => { calls.push("event:" + t); return "e-" + t; }),
    createNote: vi.fn(async (t, lines) => { calls.push("note:" + t + ":" + lines.length); return "n1"; }),
    ...over,
  };
};

describe("filing: only a decided proposal, only kept fields", () => {
  it("refuses a proposal nothing is kept in, and calls no door", async () => {
    const d = doors();
    const r = await fileProposal(make("bill", [[f("payee", "A"), f("amount", "$1.00")]]), d);
    expect(r.ok).toBe(false);
    expect(d.calls).toEqual([]);
  });

  it("files a bill with the document attached and says where it went", async () => {
    const d = doors();
    const p = approveAllSolid(make("bill", [[f("payee", "City Power"), f("amount", "$84.20"), f("dueDate", "2026-11-03")]]));
    const r = await fileProposal(p, d, () => 5);
    expect(r).toMatchObject({ ok: true, words: "Bill in Money" });
    expect(d.addBill).toHaveBeenCalledWith({ vendor: "City Power", amount: "$84.20", dueDate: "2026-11-03", notes: undefined, attachmentFileId: "file1" });
  });

  it("never writes an uncertain field that stayed undecided", async () => {
    const d = doors();
    const p = approveAllSolid(make("bill", [[f("payee", "City Power"), f("amount", "$84.20"), f("dueDate", "Nov 3", "uncertain")]]));
    await fileProposal(p, d);
    expect((d.addBill as ReturnType<typeof vi.fn>).mock.calls[0]![0].dueDate).toBeUndefined();
  });

  it("an uncertain field he keeps is written", async () => {
    const d = doors();
    let p = approveAllSolid(make("bill", [[f("payee", "City Power"), f("amount", "$84.20"), f("dueDate", "Nov 3", "uncertain")]]));
    p = decide(p, p.groups[0]!.fields.find((x) => x.key === "dueDate")!.id, "keep");
    await fileProposal(p, d);
    expect((d.addBill as ReturnType<typeof vi.fn>).mock.calls[0]![0].dueDate).toBe("Nov 3");
  });

  it("a bill without a payee or amount is not filed and says which", async () => {
    const d = doors();
    const r = await fileProposal(approveAllSolid(make("bill", [[f("amount", "$9.00")]])), d);
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/payee/);
    expect(d.addBill).not.toHaveBeenCalled();
  });

  it("an unresolved conflict blocks every door", async () => {
    const d = doors();
    const c = { key: "amount", group: "bill", candidates: [{ value: "$1", quote: "q", page: 1 }, { value: "$2", quote: "q", page: 2 }] };
    const r = await fileProposal(approveAllSolid(make("bill", [[f("payee", "A")]], [c])), d);
    expect(r.ok).toBe(false);
    expect(d.calls).toEqual([]);
  });

  it("a conflict he resolved files the side he chose", async () => {
    const d = doors();
    const c = { key: "amount", group: "bill", candidates: [{ value: "$1.00", quote: "q", page: 1 }, { value: "$2.00", quote: "q", page: 2 }] };
    let p = approveAllSolid(make("bill", [[f("payee", "A")]], [c]));
    p = resolveConflict(p, p.conflicts[0]!.id, 1);
    const r = await fileProposal(p, d);
    expect(r.ok).toBe(true);
    expect(d.calls).toEqual(["bill:A:$2.00"]);
  });
});

describe("filing: a refusal is told, never pretended past", () => {
  it("a door that refuses the bill ends the filing in words", async () => {
    const d = doors({ addBill: vi.fn(async () => ({ ok: false as const, reason: "x" })) });
    const r = await fileProposal(approveAllSolid(make("bill", [[f("payee", "A"), f("amount", "$1.00")]])), d);
    expect(r).toMatchObject({ ok: false, reason: "Money would not take that bill.", records: [] });
  });

  it("a duplicate bill is said, and nothing second is made", async () => {
    const d = doors({ addBill: vi.fn(async () => ({ ok: true as const, id: "old", duplicate: true })) });
    const r = await fileProposal(approveAllSolid(make("bill", [[f("payee", "A"), f("amount", "$1.00")]])), d);
    expect(r).toMatchObject({ ok: true });
    expect((r as { skipped: string[] }).skipped).toEqual(["A was already in Money."]);
  });

  it("a note door that returns nothing is a failure", async () => {
    const d = doors({ createNote: vi.fn(async () => null) });
    const r = await fileProposal(approveAllSolid(make("general", [[f("what", "Call the school")]])), d);
    expect(r).toMatchObject({ ok: false, reason: "The note could not be made." });
  });
});

describe("filing: events and notes", () => {
  it("files every event that has a title, a date and a start, and names the one that does not", async () => {
    const d = doors();
    const p = approveAllSolid(make("schedule", [
      [f("title", "Practice"), f("date", "2026-11-02"), f("startTime", "4:00 PM"), f("endTime", "5:30 PM"), f("location", "Gym")],
      [f("title", "Game"), f("date", "2026-11-09")],
    ]));
    const r = await fileProposal(p, d);
    expect(d.calls).toEqual(["event:Practice"]);
    expect(r).toMatchObject({ ok: true, words: "Event on the Calendar" });
    expect((r as { skipped: string[] }).skipped).toEqual(["Game needs a date and a start time to go on the calendar."]);
  });

  it("every event carries the document as its source", async () => {
    const d = doors();
    await fileProposal(approveAllSolid(make("schedule", [[f("title", "A"), f("date", "2026-11-02"), f("startTime", "9:00 AM")]])), d, () => 77);
    expect((d.createEvent as ReturnType<typeof vi.fn>).mock.calls[0]![1].source).toEqual({ type: "file", ref: "file1", ts: 77 });
  });

  it("a schedule where no event is complete files nothing and says why", async () => {
    const d = doors();
    const r = await fileProposal(approveAllSolid(make("schedule", [[f("title", "A"), f("date", "2026-11-02")]])), d);
    expect(r.ok).toBe(false);
    expect(d.createEvent).not.toHaveBeenCalled();
  });

  it("a general document becomes one note of its kept lines", async () => {
    const d = doors();
    const r = await fileProposal(approveAllSolid(make("general", [[f("what", "Bring forms"), f("person", "Coach")]])), d);
    expect(r).toMatchObject({ ok: true, words: "Note" });
    expect(d.calls).toEqual(["note:Doc:2"]);
  });
});

describe("filing: the words", () => {
  it("says where it went", () => {
    expect(filedWords([{ type: "money_bill", id: "1", label: "A" }])).toBe("Bill in Money");
    expect(filedWords([{ type: "event", id: "1", label: "A" }, { type: "event", id: "2", label: "B" }])).toBe("2 Events on the Calendar");
    expect(filedWords([{ type: "note", id: "1", label: "A" }])).toBe("Note");
  });
});
