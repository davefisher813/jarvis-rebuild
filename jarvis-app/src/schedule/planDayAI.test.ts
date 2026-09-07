import { describe, it, expect, afterEach } from "vitest";
import { parsePlanReply, aiPlanDay, planDayUserMessage, planDaySystem } from "./planDayAI";
import { setAIControl } from "../ai/levelStore";
import { setCategoryRegistry } from "../shared/categories";

describe("parsePlanReply", () => {
  it("parses a clean JSON array, preserving order", () => {
    const r = parsePlanReply('[{"id":"a","minutes":30},{"id":"b","minutes":60}]', ["a", "b"]).items;
    expect(r).toEqual([{ id: "a", minutes: 30 }, { id: "b", minutes: 60 }]);
  });

  it("strips code fences", () => {
    const r = parsePlanReply('```json\n[{"id":"a","minutes":45}]\n```', ["a"]).items;
    expect(r).toEqual([{ id: "a", minutes: 45 }]);
  });

  it("drops unknown ids and rounds/clamps minutes to 5-min steps in 10-180", () => {
    const r = parsePlanReply('[{"id":"a","minutes":7},{"id":"zzz","minutes":30},{"id":"b","minutes":999}]', ["a", "b"]).items;
    expect(r).toEqual([{ id: "a", minutes: 10 }, { id: "b", minutes: 180 }]);
  });

  it("appends tasks the model dropped, so every pick is planned", () => {
    const r = parsePlanReply('[{"id":"b","minutes":30}]', ["a", "b"]).items;
    expect(r.map((x) => x.id).sort()).toEqual(["a", "b"]);
    expect(r.find((x) => x.id === "a")?.minutes).toBe(45);
  });

  it("falls back to all-defaults on non-JSON", () => {
    const r = parsePlanReply("sorry, I cannot do that", ["a", "b"]).items;
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

  // SCHED-F-15 (2026-09-05): the Estimates gate hardcoded background: false,
  // so On Request (the level whose whole meaning is "only what he asked
  // for") let the mount-time refine through and only Off refused it.
  it("refuses the background refine when Estimates is pinned to On Request", async () => {
    setAIControl({ level: "everything", pins: { estimates: "request", morningPlan: "everything" } });
    let called = false;
    const ai = { complete: async () => { called = true; return "[]"; } } as never;
    await expect(aiPlanDay(ai, [pick("a")], [], 540, 1260, { background: true }))
      .rejects.toThrow(/Background drafting is off/);
    expect(called).toBe(false);
  });

  it("the same pin still allows the call he asked for", async () => {
    setAIControl({ level: "everything", pins: { estimates: "request", morningPlan: "everything" } });
    const ai = { complete: async () => '[{"id":"a","minutes":30}]' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260, { background: false });
    expect(r.items).toEqual([{ id: "a", minutes: 30 }]);
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

// S4-Q24 (2026-09-04): "a rule and a preference carry the same weight."
// types.ts's doctrine says strength distinguishes them; this prompt was the
// one place both still rendered as one undifferentiated list.
describe("rules vs. influences (S4-Q24)", () => {
  it("puts a rule-strength strand under its own MUST-respect header, separate from ordinary facts", () => {
    const msg = planDayUserMessage([pick("a")], [], 540, 1260, {
      strands: [
        { id: "r1", text: "Family dinner is non-negotiable", strength: "rule" },
        { id: "s1", text: "Brainstorms best at night", strength: "influence" },
      ],
    });
    expect(msg).toContain("Rules about this person you MUST respect, no exceptions:");
    expect(msg).toContain("[r1] Family dinner is non-negotiable");
    expect(msg).toContain("Facts JARVIS has learned about this person");
    expect(msg).toContain("[s1] Brainstorms best at night");
    // Neither list leaks into the other.
    const rulesBlock = msg.slice(msg.indexOf("Rules about"), msg.indexOf("Facts JARVIS has learned"));
    expect(rulesBlock).not.toContain("Brainstorms best at night");
  });

  it("a strand with no strength at all reads as an influence, unchanged from before this item", () => {
    const msg = planDayUserMessage([pick("a")], [], 540, 1260, { strands: [{ id: "s1", text: "Brainstorms best at night" }] });
    expect(msg).not.toContain("Rules about this person");
    expect(msg).toContain("Facts JARVIS has learned about this person");
  });

  it("omits the Rules header entirely when nothing is marked a rule", () => {
    const msg = planDayUserMessage([pick("a")], [], 540, 1260, {
      strands: [{ id: "s1", text: "Gets things done mid morning", strength: "influence" }],
    });
    expect(msg).not.toContain("Rules about this person");
  });

  it("omits the Facts header entirely when every strand is a rule", () => {
    const msg = planDayUserMessage([pick("a")], [], 540, 1260, {
      strands: [{ id: "r1", text: "Family dinner is non-negotiable", strength: "rule" }],
    });
    expect(msg).toContain("Rules about this person you MUST respect");
    expect(msg).not.toContain("Facts JARVIS has learned about this person");
  });

  it("the system prompt tells the model rules bind and facts merely inform", () => {
    expect(planDaySystem()).toContain("constraints on this person's day, not preferences");
  });

  it("a rule can still be cited in leaned_on like any other offered strand", async () => {
    const ai = { complete: async () => '{"items":[{"id":"a","minutes":30}],"leaned_on":["r1"]}' } as never;
    const r = await aiPlanDay(ai, [pick("a")], [], 540, 1260, {
      strands: [{ id: "r1", text: "Family dinner is non-negotiable", strength: "rule" }],
    });
    expect(r.leanedOn).toEqual(["Family dinner is non-negotiable"]);
  });
});

// AN AREA REACHES THE MODEL BY ITS NAME OR NOT AT ALL (2026-09-06). PlanPick
// carries the category ID, so every task line in this prompt used to read
// "(3fa85f64-5717-4562-b3fc-2c963f66afa6)". Third instance of BRAIN-F-05's
// class found in one day; same resolution as the other two.
describe("the task line names the area, never its id (2026-09-06)", () => {
  afterEach(() => setCategoryRegistry([]));

  const withCat = (id: string) => ({ id: "t1", text: "Call the coach", category: id, overdue: false });

  it("prints the name the user gave the area", () => {
    setCategoryRegistry([{ id: "c-elite", name: "Elite Squad", color: "blue" }]);
    const msg = planDayUserMessage([withCat("c-elite")], [], 540, 1260);
    expect(msg).toContain("- [id: t1] Call the coach (Elite Squad)");
    expect(msg).not.toContain("c-elite");
  });

  it("a uuid never reaches the prompt", () => {
    const uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    setCategoryRegistry([{ id: uuid, name: "Bridge", color: "blue" }]);
    expect(planDayUserMessage([withCat(uuid)], [], 540, 1260)).not.toContain(uuid);
  });

  it("an area the registry cannot name is omitted, not guessed at", () => {
    // Same rule as deriveSlipCategory and planningPatternObservation: the
    // clause goes rather than printing an id nobody can check. catName blanks
    // a uuid-shaped ref it cannot resolve, which is the shape every real
    // category id has (shared/categories.ts:59).
    const gone = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const msg = planDayUserMessage([withCat(gone)], [], 540, 1260);
    expect(msg).toContain("- [id: t1] Call the coach\n");
    expect(msg).not.toContain(gone);
    expect(msg).not.toContain("()");
  });

  it("a task with no area is unchanged", () => {
    const msg = planDayUserMessage([{ id: "t1", text: "Call the coach", category: "", overdue: false }], [], 540, 1260);
    expect(msg).toContain("- [id: t1] Call the coach\n");
  });

  it("still marks overdue after the area", () => {
    setCategoryRegistry([{ id: "c1", name: "Work", color: "orange" }]);
    const msg = planDayUserMessage([{ id: "t1", text: "Invoice", category: "c1", overdue: true }], [], 540, 1260);
    expect(msg).toContain("- [id: t1] Invoice (Work) [OVERDUE]");
  });
});
