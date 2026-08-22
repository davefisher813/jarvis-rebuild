// @vitest-environment jsdom
// Day Loop laws (Group C item 14 + push 16): the draft is deterministic and
// instant (zero AI), Accept is the only commit, what does not fit lands in
// Anytime out loud, re-flow moves only slipped plan blocks into real gaps,
// and overflow is reported, never silently dropped.

import { describe, it, expect, beforeEach } from "vitest";
import { draftDay, readDraft, writeDraft, reflowDay } from "./dayLoop";
import type { EventItem } from "../schedule/types";

const ev = (id: string, title: string, start: string, end?: string, sourceTaskId?: string): EventItem =>
  ({ id, data: { title, date: "2026-08-15", start, category: "", ...(end ? { end } : {}), ...(sourceTaskId ? { sourceTaskId } : {}) } }) as EventItem;

const cand = (id: string, text: string, suggested = true) => ({ id, text, category: "work", suggested });

beforeEach(() => localStorage.clear());

describe("drafting", () => {
  it("places suggested tasks into real gaps and pools the rest in Anytime", () => {
    const d = draftDay({
      date: "2026-08-15",
      candidates: [cand("a", "First"), cand("b", "Second"), cand("c", "Not suggested", false)],
      events: [ev("e1", "Meeting", "10:00", "11:00")],
      startMin: 9 * 60,
      endMin: 17 * 60,
      blocked: [],
      maxBlocks: 2,
      estimateFor: () => 45,
    });
    expect(d.blocks.length).toBe(2);
    // Both placed clear of the 10-11 meeting.
    for (const b of d.blocks) {
      const s = parseInt(b.start.slice(0, 2), 10) * 60 + parseInt(b.start.slice(3), 10);
      const e = parseInt(b.end.slice(0, 2), 10) * 60 + parseInt(b.end.slice(3), 10);
      expect(s < 11 * 60 && 10 * 60 < e).toBe(false);
    }
    expect(d.anytime.map((t) => t.id)).toEqual(["c"]);
    expect(d.accepted).toBe(false);
  });

  it("a day with no room pools everything, honestly", () => {
    const d = draftDay({
      date: "2026-08-15",
      candidates: [cand("a", "Task")],
      events: [ev("e1", "All Day", "09:00", "17:00")],
      startMin: 9 * 60,
      endMin: 17 * 60,
      blocked: [],
      maxBlocks: 3,
      estimateFor: () => 45,
    });
    expect(d.blocks.length).toBe(0);
    expect(d.anytime.map((t) => t.id)).toEqual(["a"]);
  });

  it("drafts persist per date and do not leak across days", () => {
    writeDraft(draftDay({ date: "2026-08-15", candidates: [cand("a", "T")], events: [], startMin: 540, endMin: 1020, blocked: [], maxBlocks: 3, estimateFor: () => 30 }));
    expect(readDraft("2026-08-15")).not.toBeNull();
    expect(readDraft("2026-08-16")).toBeNull();
  });
});

describe("re-flow (push 16)", () => {
  it("moves only slipped plan blocks, into the first real gap", () => {
    const plan = [ev("p1", "Slipped", "09:00", "09:45", "t1"), ev("p2", "Later", "15:00", "15:45", "t2")];
    const others = [ev("o1", "Meeting", "11:00", "12:00")];
    const res = reflowDay(plan, others, 10 * 60, 17 * 60, []);
    expect(res.moves.length).toBe(1);
    const m = res.moves[0]!;
    expect(m.eventId).toBe("p1");
    expect(m.start).toBe("10:00");
    expect(m.prevStart).toBe("09:00");
    expect(res.overflow).toEqual([]);
  });

  it("routes around meetings and upcoming plan blocks", () => {
    const plan = [ev("p1", "Slipped", "09:00", "10:00", "t1")];
    const others = [ev("o1", "Meeting", "10:00", "15:30")];
    const res = reflowDay(plan, others, 10 * 60, 17 * 60, []);
    // 15:30 end + 10 min buffer = 15:40, and the hour still fits before 5 PM.
    expect(res.moves[0]!.start).toBe("15:40");
  });

  it("overflow is reported, never silently dropped", () => {
    const plan = [ev("p1", "Slipped", "09:00", "10:00", "t1")];
    const others = [ev("o1", "Wall", "10:00", "17:00")];
    const res = reflowDay(plan, others, 10 * 60, 17 * 60, []);
    expect(res.moves).toEqual([]);
    expect(res.overflow).toEqual([{ eventId: "p1", title: "Slipped" }]);
  });

  it("nothing slipped means nothing moves", () => {
    const plan = [ev("p1", "Fine", "15:00", "15:45", "t1")];
    expect(reflowDay(plan, [], 10 * 60, 17 * 60, [])).toEqual({ moves: [], overflow: [] });
  });
});

describe("draftIsStale (hotfix 2026-08-21)", async () => {
  const { draftIsStale } = await import("./dayLoop");
  const base = { date: "2026-08-21", anytime: [], accepted: false, eventIds: [], dismissed: false };
  const blk = (start: string) => ({ taskId: "t", text: "T", category: "", start, end: "23:00" });

  it("a draft whose earliest block has passed is stale", () => {
    expect(draftIsStale({ ...base, blocks: [blk("08:30"), blk("16:00")] }, 14 * 60)).toBe(true);
  });
  it("[edge] all blocks still ahead: fresh", () => {
    expect(draftIsStale({ ...base, blocks: [blk("16:00")] }, 14 * 60)).toBe(false);
  });
  it("an accepted draft is never stale; slippage there belongs to re-flow", () => {
    expect(draftIsStale({ ...base, accepted: true, blocks: [blk("08:30")] }, 14 * 60)).toBe(false);
  });
  it("[edge] an empty draft is never stale", () => {
    expect(draftIsStale({ ...base, blocks: [] }, 14 * 60)).toBe(false);
  });
});

// NO REPETITION ON ANY PAGE (Dave 2026-08-22, from his own screenshot).
describe("plannedTaskIds", async () => {
  const { plannedTaskIds } = await import("./dayLoop");
  const base = { date: "2026-08-22", anytime: [], accepted: false, eventIds: [], dismissed: false };
  const blk = (taskId: string) => ({ taskId, text: taskId, category: "", start: "12:00", end: "12:45" });

  it("a task the draft placed is claimed, so no notice may nag about it", () => {
    const ids = plannedTaskIds({ ...base, blocks: [blk("t1"), blk("t2")] });
    expect(ids.has("t1")).toBe(true);
    expect(ids.has("t2")).toBe(true);
    expect(ids.has("t3")).toBe(false);
  });

  it("an accepted plan keeps its claim: the quiet lasts all day", () => {
    expect(plannedTaskIds({ ...base, accepted: true, blocks: [blk("t1")] }).has("t1")).toBe(true);
  });

  it("a DISMISSED draft claims nothing: he threw the plan away, so it is news again", () => {
    expect(plannedTaskIds({ ...base, dismissed: true, blocks: [blk("t1")] }).size).toBe(0);
  });

  it("[edge] no draft at all claims nothing", () => {
    expect(plannedTaskIds(null).size).toBe(0);
    expect(plannedTaskIds(undefined).size).toBe(0);
  });

  it("[edge] a draft with no blocks claims nothing", () => {
    expect(plannedTaskIds({ ...base, blocks: [] }).size).toBe(0);
  });
});

// ONE PROPOSED DAY (planning merge, phase 1, 2026-08-22).
describe("acceptInto", async () => {
  const { acceptInto } = await import("./dayLoop");
  const blk = (taskId: string, start = "12:00", end = "12:45") => ({ taskId, text: taskId, category: "", start, end });
  const base = {
    date: "2026-08-22",
    blocks: [blk("t1"), blk("t2")],
    anytime: [{ id: "t3", text: "Left over" }, { id: "t4", text: "Also left" }],
    accepted: false, eventIds: [], dismissed: false,
  };

  it("a commit resolves the standing draft: accepted, holding what was written", () => {
    const out = acceptInto(base, "2026-08-22", [blk("t1", "09:00", "10:00")], ["e1"]);
    expect(out!.accepted).toBe(true);
    expect(out!.eventIds).toEqual(["e1"]);
    expect(out!.blocks.map((b) => b.start)).toEqual(["09:00"]);
  });

  it("what just got a time leaves the Anytime pool", () => {
    const out = acceptInto(base, "2026-08-22", [blk("t3")], ["e1"]);
    expect(out!.anytime.map((a) => a.id)).toEqual(["t4"]);
  });

  // The overwrite this exists to stop: without it the card stayed up after a
  // sheet commit, and Accept swept the new blocks and wrote the old ones back.
  it("[edge] a commit for another date leaves the draft alone", () => {
    expect(acceptInto(base, "2026-08-23", [blk("t1")], ["e1"])).toBeNull();
  });

  it("[edge] a dismissed draft is not resurrected by a commit", () => {
    expect(acceptInto({ ...base, dismissed: true }, "2026-08-22", [blk("t1")], ["e1"])).toBeNull();
  });

  it("[edge] no standing draft: the commit is its own thing", () => {
    expect(acceptInto(null, "2026-08-22", [blk("t1")], ["e1"])).toBeNull();
  });
});

describe("seedFrom", async () => {
  const { seedFrom } = await import("./dayLoop");
  const blk = (taskId: string, start: string, end: string) => ({ taskId, text: taskId, category: "", start, end });
  const base = {
    date: "2026-08-22",
    blocks: [blk("t1", "09:00", "10:00"), blk("t2", "10:30", "11:15")],
    anytime: [], accepted: false, eventIds: [], dismissed: false,
  };

  it("the sheet opens on the draft's own picks, in the draft's order", () => {
    expect(seedFrom(base, ["t2", "t1"])!.ids).toEqual(["t1", "t2"]);
  });

  it("lengths come from the draft, so the sheet agrees with the card", () => {
    expect(seedFrom(base, ["t1", "t2"])!.minutes).toEqual({ t1: 60, t2: 45 });
  });

  it("a task the list no longer offers is dropped, never seeded as a phantom", () => {
    const out = seedFrom(base, ["t1"]);
    expect(out!.ids).toEqual(["t1"]);
    expect(out!.minutes.t2).toBeUndefined();
  });

  it("[edge] every pick gone means no seed, so the sheet plans fresh", () => {
    expect(seedFrom(base, [])).toBeNull();
  });

  it("[edge] a dismissed or empty draft seeds nothing", () => {
    expect(seedFrom({ ...base, dismissed: true }, ["t1"])).toBeNull();
    expect(seedFrom({ ...base, blocks: [] }, ["t1"])).toBeNull();
  });

  it("[edge] an accepted draft still seeds: re-opening the plan shows the plan", () => {
    expect(seedFrom({ ...base, accepted: true }, ["t1", "t2"])!.ids).toEqual(["t1", "t2"]);
  });
});

// EDIT IN PLACE (planning merge, phase 2, 2026-08-22).
describe("editDraft", async () => {
  const { editDraft } = await import("./dayLoop");
  const pool = [
    { id: "t1", text: "Call the county clerk", category: "home" },
    { id: "t2", text: "Draft BFFSA email", category: "work" },
    { id: "t3", text: "Mail speeding ticket", category: "money" },
  ];
  const standing = {
    date: "2026-08-22",
    blocks: [{ taskId: "t1", text: "Call the county clerk", category: "home", start: "09:00", end: "09:45" }],
    anytime: [{ id: "t2", text: "Draft BFFSA email" }, { id: "t3", text: "Mail speeding ticket" }],
    accepted: false, eventIds: [], dismissed: false,
  };
  const inp = (ids: string[], minutes: Record<string, number> = {}) => ({
    ids, minutes, pool, events: [], startMin: 9 * 60, endMin: 17 * 60,
    blocked: [], estimateFor: () => 45,
  });

  it("a longer block pushes what follows it, through the same engine", () => {
    const short = editDraft(standing, inp(["t1", "t2"]));
    const long = editDraft(standing, inp(["t1", "t2"], { t1: 120 }));
    expect(short.blocks[0]!.end).toBe("09:45");
    expect(long.blocks[0]!.end).toBe("11:00");
    // The second block moved because the first grew, not because it was told to.
    expect(long.blocks[1]!.start > short.blocks[1]!.start).toBe(true);
  });

  it("promoting from Anytime places it and takes it out of the pool", () => {
    const out = editDraft(standing, inp(["t1", "t3"]));
    expect(out.blocks.map((b) => b.taskId)).toEqual(["t1", "t3"]);
    expect(out.anytime.map((a) => a.id)).toEqual(["t2"]);
  });

  it("removing a block hands it back to Anytime, never drops it", () => {
    const out = editDraft(standing, inp([]));
    expect(out.blocks).toEqual([]);
    expect(out.anytime.map((a) => a.id).sort()).toEqual(["t1", "t2", "t3"]);
  });

  // The bug this shape prevents: patching the old anytime list instead of
  // rebuilding it lets a task sit in the plan AND the leftovers at once.
  it("no task is ever both placed and in Anytime", () => {
    const out = editDraft(standing, inp(["t1", "t2", "t3"]));
    const placed = new Set(out.blocks.map((b) => b.taskId));
    expect(out.anytime.filter((a) => placed.has(a.id))).toEqual([]);
  });

  it("order is priority: the first id claims the earlier slot", () => {
    const a = editDraft(standing, inp(["t2", "t3"]));
    expect(a.blocks[0]!.taskId).toBe("t2");
    const b = editDraft(standing, inp(["t3", "t2"]));
    expect(b.blocks[0]!.taskId).toBe("t3");
  });

  it("[edge] an id the pool no longer offers is skipped, never placed as a phantom", () => {
    const out = editDraft(standing, inp(["t1", "ghost"]));
    expect(out.blocks.map((b) => b.taskId)).toEqual(["t1"]);
  });

  it("[edge] editing never silently accepts or dismisses the draft", () => {
    const out = editDraft({ ...standing, accepted: false }, inp(["t1"]));
    expect(out.accepted).toBe(false);
    expect(out.dismissed).toBe(false);
    expect(out.date).toBe("2026-08-22");
  });
});

// THE BLEND (2026-08-22). Proposals render inside the schedule, so the rules
// about what a proposal IS have to hold as plainly as the placement ones.
describe("a proposal is not a commitment", async () => {
  const { plannedTaskIds, acceptInto, editDraft } = await import("./dayLoop");
  const blk = (taskId: string, start = "09:00", end = "09:45") => ({ taskId, text: taskId, category: "", start, end });
  const base = {
    date: "2026-08-22", blocks: [blk("t1"), blk("t2", "10:00", "10:45")],
    anytime: [], accepted: false, eventIds: [], dismissed: false,
  };

  // The row is drawn from draft.blocks while unaccepted, and from real events
  // once accepted. If acceptInto did not flip the flag, every accepted task
  // would draw twice: once solid, once dashed.
  it("accepting flips the flag the renderer gates on, so no dashed twin survives", () => {
    const out = acceptInto(base, "2026-08-22", base.blocks, ["e1", "e2"]);
    expect(out!.accepted).toBe(true);
  });

  it("a dismissed proposal claims nothing, so the day stops drawing it", () => {
    expect(plannedTaskIds({ ...base, dismissed: true }).size).toBe(0);
  });

  // Schedule feeds proposals into openSlots as busy. That is only honest if
  // the blocks carry real ends, which the engine always writes.
  it("every proposal carries a real end, so it can be counted as busy time", () => {
    const pool = [{ id: "t1", text: "One", category: "" }, { id: "t2", text: "Two", category: "" }];
    const out = editDraft(base, {
      ids: ["t1", "t2"], minutes: { t1: 60, t2: 30 }, pool, events: [],
      startMin: 9 * 60, endMin: 17 * 60, blocked: [], estimateFor: () => 45,
    });
    for (const b of out.blocks) {
      expect(b.end).toMatch(/^\d{2}:\d{2}$/);
      expect(b.end > b.start).toBe(true);
    }
  });

  it("proposals never overlap each other, so the day cannot show two at one time", () => {
    const pool = [
      { id: "t1", text: "One", category: "" },
      { id: "t2", text: "Two", category: "" },
      { id: "t3", text: "Three", category: "" },
    ];
    const out = editDraft(base, {
      ids: ["t1", "t2", "t3"], minutes: { t1: 120, t2: 90, t3: 60 }, pool, events: [],
      startMin: 9 * 60, endMin: 20 * 60, blocked: [], estimateFor: () => 45,
    });
    const m = (t: string) => { const p = t.split(":"); return Number(p[0]) * 60 + Number(p[1]); };
    const sorted = [...out.blocks].sort((a, b) => m(a.start) - m(b.start));
    for (let i = 1; i < sorted.length; i++) {
      expect(m(sorted[i]!.start) >= m(sorted[i - 1]!.end)).toBe(true);
    }
  });
});
