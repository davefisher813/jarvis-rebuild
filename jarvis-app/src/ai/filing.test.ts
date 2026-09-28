// Brain Manual v1 (Phase 1): filing.ts + filingIntake.ts unit tests, the
// voice guards plus the intake payload and undo. Chat filing (the parser and
// its triggers) was cut from v1, with its tests.
import { describe, it, expect } from "vitest";
import { voiceGuard, countWords } from "./filing";
import {
  fileMemory,
  undoFiling,
  oldestVoiceSample,
  type FilingStore,
} from "./filingIntake";
import type { BrainMemoryRow } from "./brainMemory";

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

describe("undoFiling", () => {
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
