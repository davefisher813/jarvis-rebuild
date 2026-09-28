// Brain Manual v1 (Phase 1) — filing.ts + filingIntake.ts unit tests.
// Flow doc §7, test 1 (filingParse) plus the intake payload/write/undo.
import { describe, it, expect } from "vitest";
import {
  FILING_SCHEMA,
  parseFiling,
  detectFilingTrigger,
  needsClarification,
  voiceGuard,
  countWords,
} from "./filing";
import {
  fileMemory,
  saveFiling,
  undoFiling,
  oldestVoiceSample,
  type FilingStore,
} from "./filingIntake";
import { schemaOk } from "./structured";
import type { BrainMemoryRow } from "./brainMemory";

describe("FILING_SCHEMA", () => {
  it("is a small valid tool schema like CAPTURE_SCHEMA", () => {
    expect(schemaOk(FILING_SCHEMA)).toBe(true);
    expect((FILING_SCHEMA.required as string[])).toEqual(["category", "text"]);
  });
});

describe("parseFiling", () => {
  it("parses a filing in each category", () => {
    const raw = JSON.stringify({ category: "philosophy", text: "Discipline beats motivation." });
    expect(parseFiling(raw)).toEqual({ category: "philosophy", text: "Discipline beats motivation." });
  });
  it("trims text and drops a malformed optional date", () => {
    const raw = JSON.stringify({ category: "decision", text: "  Go to bed by 11.  ", date: "not-a-date" });
    const r = parseFiling(raw);
    expect(r?.text).toBe("Go to bed by 11.");
    expect(r?.date).toBeUndefined();
  });
  it("keeps a well-formed date and why", () => {
    const raw = JSON.stringify({ category: "decision", text: "Ship it.", why: "Momentum.", date: "2026-09-20" });
    expect(parseFiling(raw)).toEqual({ category: "decision", text: "Ship it.", why: "Momentum.", date: "2026-09-20" });
  });
  it("tolerates code fences", () => {
    expect(parseFiling('```json\n{"category":"fact","text":"Tucci ends Sept 1."}\n```')?.category).toBe("fact");
  });
  it("returns null on missing fields, bad category, bad JSON", () => {
    expect(parseFiling(JSON.stringify({ category: "philosophy" }))).toBeNull();
    expect(parseFiling(JSON.stringify({ category: "mood", text: "x" }))).toBeNull();
    expect(parseFiling(JSON.stringify({ category: "fact", text: "   " }))).toBeNull();
    expect(parseFiling("not json at all")).toBeNull();
    expect(parseFiling(null)).toBeNull();
  });
  it("scrubs em dashes from model-authored text, not from voice", () => {
    const dash = JSON.stringify({ category: "fact", text: "a — b" });
    expect(parseFiling(dash)?.text).toBe("a, b");
    const voice = JSON.stringify({ category: "voice", text: "a — b" });
    expect(parseFiling(voice)?.text).toBe("a — b");
  });
});

describe("detectFilingTrigger", () => {
  it("returns the text after the trigger, null for normal chat", () => {
    expect(detectFilingTrigger("log it: discipline beats motivation")).toBe("discipline beats motivation");
    expect(detectFilingTrigger("Remember this: my kid's birthday")).toBe("my kid's birthday");
    expect(detectFilingTrigger("log this decision — ship it")).toBe("ship it");
    expect(detectFilingTrigger("how is the weather today")).toBeNull();
  });
});

describe("needsClarification", () => {
  it("true when unfileable, false when complete", () => {
    expect(needsClarification(null)).toBe(true);
    expect(needsClarification({ category: "fact", text: "" })).toBe(true);
    expect(needsClarification({ category: "fact", text: "ok" })).toBe(false);
  });
});

describe("voiceGuard", () => {
  it("flags short samples, duplicates, and ok", () => {
    expect(voiceGuard("too short", [])).toBe("too-short");
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    expect(voiceGuard(long, [])).toBe("ok");
    expect(voiceGuard(long, [long.toUpperCase().replace(/word/g, "WORD,")])).toBe("duplicate");
  });
  it("countWords counts whitespace-separated tokens", () => {
    expect(countWords("  a b  c ")).toBe(3);
  });
});

const fakeStore = (): FilingStore & { created: unknown[]; deleted: string[] } => {
  const created: unknown[] = [];
  const deleted: string[] = [];
  return {
    created,
    deleted,
    async create(_owner, _type, data, id) { created.push({ data, id }); return id ?? "new-id"; },
    async delete(_owner, id) { deleted.push(id); },
  };
};

const row = (id: string, created: string): BrainMemoryRow => ({
  id,
  created_at: created,
  updated_at: created,
  data: { category: "voice", state: "LEARNED", text: "x", source: "email" },
});

describe("fileMemory", () => {
  it("builds the §2 payload: LEARNED, auto date + active status for decisions", () => {
    const d = fileMemory({ category: "decision", text: " Ship it. ", why: "Momentum", source: "manual-chat", linkedItemIds: ["t1"] });
    expect(d.state).toBe("LEARNED");
    expect(d.status).toBe("active");
    expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.text).toBe("Ship it.");
    expect(d.why).toBe("Momentum");
    expect(d.linkedItemIds).toEqual(["t1"]);
  });
  it("sets wordCount for voice, not for facts", () => {
    const v = fileMemory({ category: "voice", text: "one two three", source: "email" });
    expect(v.wordCount).toBe(3);
    expect(fileMemory({ category: "fact", text: "x", source: "note" }).wordCount).toBeUndefined();
  });
});

describe("saveFiling / undoFiling", () => {
  it("writes a brain_memory row and returns the id", async () => {
    const store = fakeStore();
    const id = await saveFiling({ category: "fact", text: "x", source: "note" }, { store, ownerId: "u1" });
    expect(id).toBe("new-id");
    expect(store.created).toHaveLength(1);
  });
  it("undo deletes exactly the created row, restoring a replaced voice sample by id", async () => {
    const store = fakeStore();
    const replaced = fileMemory({ category: "voice", text: "old sample", source: "email" });
    await undoFiling("row-9", { store, ownerId: "u1" }, { id: "old-id", data: replaced });
    expect(store.deleted).toEqual(["row-9"]);
    expect((store.created[0] as { id?: string }).id).toBe("old-id");
  });
});

describe("oldestVoiceSample", () => {
  it("null until the cap is reached, then the oldest row", () => {
    const four = [1, 2, 3, 4].map((i) => row(`v${i}`, `2026-09-0${i}T00:00:00Z`));
    expect(oldestVoiceSample(four)).toBeNull();
    const five = [...four, row("v5", "2026-09-05T00:00:00Z")];
    expect(oldestVoiceSample(five)?.id).toBe("v1");
  });
});
