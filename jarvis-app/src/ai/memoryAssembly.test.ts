// Brain Manual v1 (Phase 1) — memory assembler tests.
// Flow doc §7, tests 3 (memoryAssembly), 4 (retrieval), 8 (citationRule).
// Pure: assembleMemory takes fetched rows and renders the budgeted prompt
// block, so every case below is rows-in/text-out with no store.

import { describe, it, expect } from "vitest";
import {
  assembleMemory,
  draftInstructions,
  overlapScore,
  toContextInput,
  type PersonRow,
} from "./memoryAssemble";
import {
  MEMORY_BUDGET_CHARS,
  VOICE_SAMPLE_CAP,
  type BrainMemoryCategory,
  type BrainMemoryRow,
  type BrainMemoryState,
} from "./brainMemory";

const row = (
  id: string,
  category: BrainMemoryCategory,
  text: string,
  opts: {
    pinned?: boolean;
    created?: string;
    why?: string;
    date?: string;
    status?: "active" | "reversed" | "archived";
    state?: BrainMemoryState;
  } = {},
): BrainMemoryRow => ({
  id,
  created_at: opts.created ?? "2026-09-20T12:00:00Z",
  updated_at: opts.created ?? "2026-09-20T12:00:00Z",
  data: {
    category,
    state: opts.state ?? "LEARNED",
    text,
    source: "manual-chat",
    pinned: opts.pinned ?? false,
    ...(opts.why ? { why: opts.why } : {}),
    ...(opts.date ? { date: opts.date } : {}),
    ...(opts.status ? { status: opts.status } : {}),
  },
});

const person = (
  id: string,
  name: string,
  roles: string[] = [],
  roleNote?: string,
): PersonRow => ({
  id,
  created_at: "2026-09-20T12:00:00Z",
  updated_at: "2026-09-20T12:00:00Z",
  data: { name, roles, ...(roleNote ? { roleNote } : {}) },
});

const MSG = "should we expand the summer tournament schedule this year";

describe("memoryAssembly: budget cap and ordering (flow doc §3)", () => {
  it("caps the block at MEMORY_BUDGET_CHARS and names what was cut", () => {
    const facts = Array.from(
      { length: 400 },
      (_, i) => row(`f${i}`, "fact", `Training note ${i}: ` + "baseball ".repeat(12)),
    );
    const m = assembleMemory({ memories: facts, people: [], message: "hello world", isDraft: false });
    expect(m.sections.facts.omitted).toBeGreaterThan(0);
    expect(m.contextBlock).toContain(`+${m.sections.facts.omitted} more facts filed`);
    // Headers ride outside the capped sections, so the allowance is the
    // section cap plus a small constant for them.
    expect(m.memoryChars).toBeLessThanOrEqual(MEMORY_BUDGET_CHARS + 64);
  });

  it("orders pinned first, then newest", () => {
    const facts = [
      row("old", "fact", "unpinned old", { created: "2026-09-02T12:00:00Z" }),
      row("pin", "fact", "pinned one", { pinned: true, created: "2026-09-01T12:00:00Z" }),
      row("new", "fact", "unpinned new", { created: "2026-09-03T12:00:00Z" }),
    ];
    const m = assembleMemory({ memories: facts, people: [], message: "", isDraft: false });
    expect(m.sections.facts.texts).toEqual(["pinned one", "unpinned new", "unpinned old"]);
  });

  it("caps philosophy at 2,000 chars with a +N more line", () => {
    const items = [1, 2, 3].map((i) =>
      row(`p${i}`, "philosophy", `principle ${i} ` + "x".repeat(890)),
    );
    const m = assembleMemory({ memories: items, people: [], message: "", isDraft: false });
    expect(m.sections.philosophy.omitted).toBe(1);
    expect(m.contextBlock).toContain("+1 more philosophy items filed");
    expect(m.contextBlock).toContain("PHILOSOPHY");
  });

  it("excludes voice from chat context, includes it on draft instructions", () => {
    const sample = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const memories = [row("v1", "voice", sample)];
    const chat = assembleMemory({ memories, people: [], message: "", isDraft: false });
    expect(chat.sections.voice.texts).toEqual([]);
    expect(chat.contextBlock).not.toContain("VOICE");
    const draft = assembleMemory({ memories, people: [], message: "", isDraft: true });
    expect(draft.sections.voice.texts).toEqual([sample]);
    expect(draft.contextBlock).toContain("VOICE");
  });

  it("never assembles rows that are not LEARNED", () => {
    const memories = [
      row("prop", "fact", "a proposal", { state: "PROPOSED" as BrainMemoryState }),
    ];
    const m = assembleMemory({ memories, people: [], message: "", isDraft: false });
    expect(m.contextBlock).toBe("");
  });

  it("toContextInput maps the assembly into AIContextInput fields", () => {
    const memories = [
      row("v1", "voice", Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ")),
      row("f1", "fact", "Dave files fast."),
    ];
    const chat = toContextInput(
      assembleMemory({ memories, people: [], message: "", isDraft: false }),
    );
    expect(chat.voiceSamples).toEqual([]);
    expect(chat.facts).toEqual(["Dave files fast."]);
    const draft = toContextInput(
      assembleMemory({ memories, people: [], message: "", isDraft: true }),
    );
    expect(draft.voiceSamples).toHaveLength(1);
  });

  it(`voice context never carries more than ${VOICE_SAMPLE_CAP} samples`, () => {
    const samples = Array.from({ length: 8 }, (_, i) =>
      row(`v${i}`, "voice", `sample ${i} ` + Array.from({ length: 60 }, (_, j) => `w${j}`).join(" ")),
    );
    const m = assembleMemory({ memories: samples, people: [], message: "", isDraft: true });
    expect(m.sections.voice.texts).toHaveLength(VOICE_SAMPLE_CAP);
  });
});

describe("retrieval: keyword overlap (flow doc §3.4)", () => {
  const relevant = row("d1", "decision", "We will run the summer tournament in July", {
    date: "2026-03-15",
    why: "Momentum matters",
  });
  const irrelevant = row("d2", "decision", "Buy new baseballs for practice");
  const belowThreshold = row("d3", "decision", "Expand the budget for next season");

  it("surfaces the relevant decision with its date; the irrelevant one stays out", () => {
    const m = assembleMemory({ memories: [relevant, irrelevant], people: [], message: MSG, isDraft: false });
    expect(m.sections.decisions.texts).toHaveLength(1);
    expect(m.sections.decisions.texts[0]).toContain("We will run the summer tournament in July");
    // Surfaced decisions always show their date so stale ones read as stale.
    expect(m.sections.decisions.texts[0]).toContain("(decided Mar 2026)");
    expect(m.sections.decisions.ids).toEqual(["d1"]);
  });

  it("honors the score threshold: 2 surfaces, 1 does not", () => {
    expect(overlapScore(MSG, "We will run the summer tournament in July")).toBe(2);
    expect(overlapScore(MSG, "Expand the budget for next season")).toBe(1);
    const m = assembleMemory({ memories: [relevant, belowThreshold], people: [], message: MSG, isDraft: false });
    expect(m.sections.decisions.ids).toEqual(["d1"]);
  });

  it("returns at most the top 3 decisions", () => {
    const five = [1, 2, 3, 4, 5].map((i) =>
      row(`t${i}`, "decision", `summer tournament schedule call number ${i}`),
    );
    const m = assembleMemory({ memories: five, people: [], message: MSG, isDraft: false });
    expect(m.sections.decisions.ids).toHaveLength(3);
  });

  it("archived decisions never surface, however relevant", () => {
    const archived = row("old", "decision", "summer tournament schedule forever", {
      status: "archived",
    });
    const m = assembleMemory({ memories: [archived], people: [], message: MSG, isDraft: false });
    expect(m.sections.decisions.ids).toEqual([]);
  });

  it("a person named in the message is an automatic include, with role and note", () => {
    const johan = person("p1", "Johan", ["friend"], "plays baseball");
    const m = assembleMemory({
      memories: [],
      people: [johan],
      message: "is Johan coming to the game on saturday",
      isDraft: false,
    });
    expect(m.sections.people.entries[0]).toEqual({
      name: "Johan",
      label: "friend; plays baseball",
    });
    expect(m.sections.people.texts[0]).toBe("Johan (friend; plays baseball)");
  });

  it("people surface by keyword overlap even when not named", () => {
    const maya = person("p2", "Maya", [], "marathon training partner");
    const m = assembleMemory({
      memories: [],
      people: [maya],
      message: "who is my marathon training partner",
      isDraft: false,
    });
    expect(m.sections.people.ids).toEqual(["p2"]);
  });

  it("an unrelated person stays out", () => {
    const sam = person("p3", "Sam", ["vendor"], "fixes the batting cage net");
    const m = assembleMemory({
      memories: [],
      people: [sam],
      message: "who is my marathon training partner",
      isDraft: false,
    });
    expect(m.sections.people.ids).toEqual([]);
  });
});

describe("citationRule (draftInstructions)", () => {
  it("contains the cite-with-date rule when memory is non-empty", () => {
    const m = assembleMemory({
      memories: [row("f1", "fact", "Dave files fast.")],
      people: [],
      message: "",
      isDraft: false,
    });
    const instructions = draftInstructions(m);
    expect(instructions).toContain("per your decision in March");
    expect(instructions).toContain("date");
  });

  it("is empty when the brain is empty", () => {
    const m = assembleMemory({ memories: [], people: [], message: "", isDraft: false });
    expect(m.contextBlock).toBe("");
    expect(draftInstructions(m)).toBe("");
  });
});
