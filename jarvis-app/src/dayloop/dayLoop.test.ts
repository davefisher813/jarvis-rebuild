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
