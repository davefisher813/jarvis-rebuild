import { describe, it, expect } from "vitest";
import { extractDocument, sliceDoc, MAX_SLICES, SLICE_CHARS, type AICall, type AIRequest } from "./extract";
import { assembleDocText } from "./readText";
import type { DocText } from "./types";

const TODAY = new Date(2026, 9, 23);
const BILL = "GEICO Auto Insurance\nAmount due: $1,234.50\nPay by October 24, 2026";
const mk = (pages: string[]): DocText => assembleDocText(pages.map((t, i) => ({ page: i + 1, text: t })), "text-layer");
const env = (key: string, value: string, quote: string, page = 1, basis = "stated") => ({ key, value, quote, page, basis });
const script = (cls: unknown, ...extracts: unknown[]): { call: AICall; seen: AIRequest[] } => {
  const seen: AIRequest[] = [];
  let i = 0;
  return { seen, call: async (req) => {
    seen.push(req);
    if (req.purpose === "classify") return { ok: true, json: cls, truncated: false };
    const j = extracts[Math.min(i++, extracts.length - 1)];
    return { ok: true, json: j, truncated: false };
  } };
};

describe("a bill becomes one item of checked fields", () => {
  it("keeps what is quoted and drops what is invented", async () => {
    const { call } = script({ kind: "bill", actionable: true, title: "GEICO Auto" }, { items: [{ group: "bill", fields: [
      env("payee", "GEICO", "GEICO Auto Insurance"),
      env("amount", "1234.50", "Amount due: $1,234.50"),
      env("dueDate", "2026-10-24", "Pay by October 24, 2026"),
      env("accountRef", "ZX-991", "Account ZX-991"),                 // not in the document
      env("minimumDue", "99", "Amount due: $1,234.50"),              // value not in its quote
    ] }] });
    const out = await extractDocument(mk([BILL]), call, TODAY);
    if (!out.ok) throw new Error("expected ok");
    expect(out.title).toBe("GEICO Auto");
    expect(out.result.kind).toBe("bill");
    const f = out.result.items[0]!.fields;
    expect(f.map((x) => x.key).sort()).toEqual(["amount", "dueDate", "payee"]);
    expect(f.every((x) => x.tier === "solid")).toBe(true);
    expect(out.result.droppedCount).toBe(2);
  });
  it("a model key outside the kind's list is ignored, not trusted", async () => {
    const { call } = script({ kind: "bill", actionable: true }, { items: [{ group: "bill", fields: [env("ssn", "123", "Amount due: $1,234.50"), env("amount", "1234.50", "Amount due: $1,234.50")] }] });
    const out = await extractDocument(mk([BILL]), call, TODAY);
    if (!out.ok) throw new Error("x");
    expect(out.result.items[0]!.fields.map((x) => x.key)).toEqual(["amount"]);
  });
  it("nothing actionable is a success with nothing proposed", async () => {
    const { call, seen } = script({ kind: "letter", actionable: false });
    const out = await extractDocument(mk(["Dear Dave, thanks for a lovely visit."]), call, TODAY);
    if (!out.ok) throw new Error("x");
    expect(out.result.items).toEqual([]);
    expect(out.result.actionable).toBe(false);
    expect(seen.length).toBe(1);
  });
  it("the model's own page number is ignored: the page comes from the document", async () => {
    const { call } = script({ kind: "bill", actionable: true }, { items: [{ group: "bill", fields: [env("amount", "1234.50", "Amount due: $1,234.50", 7)] }] });
    const out = await extractDocument(mk([BILL]), call, TODAY);
    if (!out.ok) throw new Error("x");
    expect(out.result.items[0]!.fields[0]!.page).toBe(1);
  });
});

describe("long documents are sliced behind the door and merged by code", () => {
  const long = (n: number) => mk(Array.from({ length: n }, (_, i) => (i === 0 ? BILL : i === 2 ? "Amount due: $1,299.00" : "x ".repeat(SLICE_CHARS / 2 - 30))));
  it("slices fit under the cap", () => {
    const slices = sliceDoc(long(5));
    for (const s of slices) expect(s.pages.reduce((t, p) => t + p.text.length, 0)).toBeLessThanOrEqual(SLICE_CHARS);
  });
  it("two slices that disagree about money surface as a conflict; neither wins", async () => {
    const { call } = script({ kind: "bill", actionable: true },
      { items: [{ group: "bill", fields: [env("payee", "GEICO", "GEICO Auto Insurance"), env("amount", "1234.50", "Amount due: $1,234.50")] }] },
      { items: [{ group: "bill", fields: [env("amount", "1299.00", "Amount due: $1,299.00", 3)] }] });
    const out = await extractDocument(long(3), call, TODAY);
    if (!out.ok) throw new Error("x");
    expect(out.result.conflicts).toHaveLength(1);
    expect(out.result.conflicts[0]!.key).toBe("amount");
    expect(out.result.conflicts[0]!.candidates.map((c) => c.value).sort()).toEqual(["1234.50", "1299.00"]);
    expect(out.result.items[0]!.fields.map((f) => f.key)).toEqual(["payee"]);
  });
  it("a document longer than the run's slices says which pages it did not reach", async () => {
    const { call } = script({ kind: "general", actionable: true }, { items: [] });
    const doc = mk(Array.from({ length: 12 }, () => "y ".repeat(SLICE_CHARS / 2 - 30)));
    const out = await extractDocument(doc, call, TODAY);
    if (!out.ok) throw new Error("x");
    expect(out.result.missingPages.length).toBeGreaterThan(0);
    expect(out.result.missingPages[0]).toBe(MAX_SLICES + 1);
  });
  it("a reply cut off by the output cap is partial for its pages, not whole", async () => {
    const call: AICall = async (r) => r.purpose === "classify" ? { ok: true, json: { kind: "schedule", actionable: true }, truncated: false } : { ok: true, json: { items: [] }, truncated: true };
    const out = await extractDocument(mk(["A schedule page"]), call, TODAY);
    if (!out.ok) throw new Error("x");
    expect(out.result.missingPages).toEqual([1]);
  });
  it("pages that could not be read stay named", async () => {
    const d = { ...mk(["Some page text here"]), failedPages: [2] };
    const { call } = script({ kind: "general", actionable: true }, { items: [] });
    const out = await extractDocument(d, call, TODAY);
    if (!out.ok) throw new Error("x");
    expect(out.result.missingPages).toEqual([2]);
  });
});

describe("a refusal stops the run and keeps its name", () => {
  for (const code of ["OFF", "CREDIT", "BUSY", "UNKNOWN"] as const) {
    it(code, async () => {
      const out = await extractDocument(mk([BILL]), async () => ({ ok: false, code }), TODAY);
      expect(out).toEqual({ ok: false, code });
    });
  }
  it("a failure on the second call after a good classify still stops with that code", async () => {
    let n = 0;
    const out = await extractDocument(mk([BILL]), async () => (n++ === 0 ? { ok: true, json: { kind: "bill", actionable: true }, truncated: false } : { ok: false, code: "CREDIT" }), TODAY);
    expect(out).toMatchObject({ ok: false, code: "CREDIT" });
  });
});

describe("schedule items", () => {
  it("one item per event, dates and times checked", async () => {
    const text = "Fall Schedule\nSat Oct 24, 2026 - Game vs Tigers 9:00 AM at Field 2\nSat Oct 31, 2026 - Game vs Lions 11:30 AM at Field 4";
    const { call } = script({ kind: "schedule", actionable: true }, { items: [
      { group: "event", fields: [env("title", "Game vs Tigers", "Game vs Tigers"), env("date", "2026-10-24", "Sat Oct 24, 2026"), env("startTime", "09:00", "9:00 AM"), env("location", "Field 2", "Field 2")] },
      { group: "event", fields: [env("title", "Game vs Lions", "Game vs Lions"), env("date", "2026-10-31", "Sat Oct 31, 2026"), env("startTime", "11:30", "11:30 AM")] },
      { group: "event", fields: [env("title", "Playoffs", "Playoffs"), env("date", "2026-11-07", "Sat Nov 7, 2026")] },
    ] });
    const out = await extractDocument(mk([text]), call, TODAY);
    if (!out.ok) throw new Error("x");
    expect(out.result.items).toHaveLength(2);  // the invented third event has no quote in the document
    expect(out.result.items[0]!.fields.find((f) => f.key === "startTime")!.tier).toBe("solid");
  });
});
