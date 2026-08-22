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
