import { describe, it, expect, afterEach } from "vitest";
import { parseAIPlan, aiPlanDay, planDayUserMessage, planDaySystem } from "./planDayAI";
import { setAIControl } from "../ai/levelStore";

describe("parseAIPlan", () => {
  it("parses a clean JSON array, preserving order", () => {
    const r = parseAIPlan('[{"id":"a","minutes":30},{"id":"b","minutes":60}]', ["a", "b"]);
    expect(r).toEqual([{ id: "a", minutes: 30 }, { id: "b", minutes: 60 }]);
  });

  it("strips code fences", () => {
    const r = parseAIPlan('```json\n[{"id":"a","minutes":45}]\n```', ["a"]);
    expect(r).toEqual([{ id: "a", minutes: 45 }]);
  });

  it("drops unknown ids and rounds/clamps minutes to 5-min steps in 10-180", () => {
    const r = parseAIPlan('[{"id":"a","minutes":7},{"id":"zzz","minutes":30},{"id":"b","minutes":999}]', ["a", "b"]);
    expect(r).toEqual([{ id: "a", minutes: 10 }, { id: "b", minutes: 180 }]);
  });

  it("appends tasks the model dropped, so every pick is planned", () => {
    const r = parseAIPlan('[{"id":"b","minutes":30}]', ["a", "b"]);
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(r.find((x) => x.id === "a")?.minutes).toBe(45);
  });

  it("falls back to all-defaults on non-JSON", () => {
    const r = parseAIPlan("sorry, I cannot do that", ["a", "b"]);
    expect(r).toEqual([{ id: "a", minutes: 45 }, { id: "b", minutes: 45 }]);
  });
});

const pick = (id: string) => ({ id, text: id, category: "", overdue: false });

describe("aiPlanDay", () => {
  it("returns parsed items on success", async () => {
    const ai = { complete: async () => '[{"id":"a","minutes":30}]' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260);
    expect(r.items).toEqual([{ id: "a", minutes: 30 }]);
    expect(r.leanedOn).toEqual([]);
  });

  it("propagates errors so the sheet can fall back to the simple plan", async () => {
    const ai = { complete: async () => { throw new Error("boom"); } } as never;
    await expect(aiPlanDay(ai, [pick("a")], [], 540, 1260)).rejects.toThrow();
  });

  it("rejects when the call exceeds the timeout, so the sheet falls back", async () => {
    const ai = { complete: () => new Promise<string>(() => { /* never resolves */ }) } as never;
    await expect(aiPlanDay(ai, [pick("a")], [], 540, 1260, { timeoutMs: 10 })).rejects.toThrow(/timed out/);
  });
});

// B3-9 (2026-09-04): "two AI pins change nothing." Morning Plan and
// Estimates were declared in AI Control and never passed to a call; this is
// the one call both name (its own header: order the picks AND estimate a
// length for each).
describe("aiPlanDay respects the Morning Plan and Estimates pins", () => {
  afterEach(() => setAIControl(undefined));

  it("passes pin: morningPlan to AIService, so its own gate and What Ran both see this call as Morning Plan", async () => {
    let seenPin: string | undefined;
    const ai = { complete: async (_m: unknown, _s: unknown, opts?: { pin?: string }) => { seenPin = opts?.pin; return '[{"id":"a","minutes":30}]'; } } as never;
    await aiPlanDay(ai, [pick("a")], [], 540, 1260);
    expect(seenPin).toBe("morningPlan");
  });

  it("refuses outright, without ever reaching AIService, when Estimates is pinned off", async () => {
    setAIControl({ level: "everything", pins: { estimates: "off" } });
    let called = false;
    const ai = { complete: async () => { called = true; return "[]"; } } as never;
    await expect(aiPlanDay(ai, [pick("a")], [], 540, 1260)).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("still fires when both pins allow it, master off or on", async () => {
    setAIControl({ level: "everything", pins: { estimates: "everything", morningPlan: "everything" } });
    const ai = { complete: async () => '[{"id":"a","minutes":30}]' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260);
    expect(r.items).toEqual([{ id: "a", minutes: 30 }]);
  });
});

describe("planDayUserMessage profile line (Brain Personalization Phase 1, 2026-08-06)", () => {
  it("includes the assembled profile context when given", () => {
    const msg = planDayUserMessage([pick("a")], [], 540, 1260, { profile: "Values: family first." });
    expect(msg).toContain("About this person, from their JARVIS profile:");
    expect(msg).toContain("Values: family first.");
  });

  it("omits the profile line entirely when there is none, unchanged from before", () => {
    const msg = planDayUserMessage([pick("a")], [], 540, 1260);
    expect(msg).not.toContain("About this person");
  });

  it("omits the profile line for blank/whitespace-only profile text", () => {
    const msg = planDayUserMessage([pick("a")], [], 540, 1260, { profile: "   " });
    expect(msg).not.toContain("About this person");
  });
});

// Brain Layer 2 (item 04): honest attribution. The model may say WHICH learned
// facts changed its plan, and a citation survives only if it names a fact that
// was actually offered. An invented reason is decoration, and decoration is
// exactly what the design doc banned.
describe("attribution", () => {
  const STRANDS = [
    { id: "s1", text: "Gets things done mid morning" },
    { id: "s2", text: "Money tasks tend to slip" },
  ];

  it("offers the strands with their ids, and asks for citations", () => {
    const msg = planDayUserMessage([pick("a")], [], 540, 1260, { strands: STRANDS });
    expect(msg).toContain("[s1] Gets things done mid morning");
    expect(msg).toContain("[s2] Money tasks tend to slip");
    expect(planDaySystem()).toContain("leaned_on");
  });

  it("says nothing about facts when there are none to offer", () => {
    expect(planDayUserMessage([pick("a")], [], 540, 1260)).not.toContain("leaned_on");
  });

  it("returns the texts of the facts the model actually cited", async () => {
    const ai = { complete: async () => '{"items":[{"id":"a","minutes":30}],"leaned_on":["s1"]}' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260, { strands: STRANDS });
    expect(r.items).toEqual([{ id: "a", minutes: 30 }]);
    expect(r.leanedOn).toEqual(["Gets things done mid morning"]);
  });

  it("drops a citation for a fact that was never offered", async () => {
    const ai = { complete: async () => '{"items":[{"id":"a","minutes":30}],"leaned_on":["s9","s1"]}' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260, { strands: STRANDS });
    expect(r.leanedOn).toEqual(["Gets things done mid morning"]);
  });

  it("accepts an empty citation list as a real answer", async () => {
    const ai = { complete: async () => '{"items":[{"id":"a","minutes":30}],"leaned_on":[]}' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260, { strands: STRANDS });
    expect(r.leanedOn).toEqual([]);
  });

  it("still plans when the model answers in the old bare-array shape", async () => {
    const ai = { complete: async () => '[{"id":"a","minutes":30}]' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260, { strands: STRANDS });
    expect(r.items).toEqual([{ id: "a", minutes: 30 }]);
    expect(r.leanedOn).toEqual([]);
  });

  it("de-duplicates a fact cited twice", async () => {
    const ai = { complete: async () => '{"items":[{"id":"a","minutes":30}],"leaned_on":["s1","s1"]}' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260, { strands: STRANDS });
    expect(r.leanedOn).toEqual(["Gets things done mid morning"]);
  });
});
