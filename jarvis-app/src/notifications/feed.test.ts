import { describe, it, expect } from "vitest";
import { buildFeed, dismissNudge, loadNudgeDismissed } from "./feed";
import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";
import type { Goal, Area } from "../life/types";

const T = (id: string, text: string, due: string | null, done = false): TaskItem => ({ id, data: { text, category: "", done, due } });
const E = (id: string, title: string, date: string, start: string): EventItem => ({ id, data: { title, date, start, category: "" } });

describe("buildFeed", () => {
  it("orders overdue, due today, then today's events; respects done", () => {
    const tasks = [T("1", "Pay invoice", "2026-05-01"), T("2", "Call bank", "2026-05-24"), T("3", "Done thing", "2026-05-01", true)];
    const events = [E("9", "Standup", "2026-05-24", "09:00")];
    const feed = buildFeed({ tasks, events, goals: [], areas: [] }, "2026-05-24");
    expect(feed.map((n) => n.kind)).toEqual(["overdue", "due_today", "event"]);
    expect(feed[2]!.when).toBe("09:00");
    expect(feed.find((n) => n.title === "Done thing")).toBeUndefined();
  });
  it("includes at-risk goals and drifting areas", () => {
    const goals: Goal[] = [{ id: "g", data: { title: "Ship app", state: "at_risk" } }];
    const areas: Area[] = [{ id: "a", data: { name: "Health", state: "drifting" } }];
    const feed = buildFeed({ tasks: [], events: [], goals, areas }, "2026-05-24");
    expect(feed.map((n) => n.kind)).toEqual(["goal_risk", "area_drift"]);
  });
});

// LAW 1 (Dave 2026-08-29, "notifications show up on things that are already
// done"): this screen only ever filtered events on the DATE, so a 9 AM
// standup was still listed as a live notification at 10 PM.
describe("buildFeed and the clock", () => {
  const at = (id: string, start: string, end?: string): EventItem =>
    ({ id, data: { title: "Standup", date: "2026-05-24", start, category: "", ...(end ? { end } : {}) } });

  it("drops events that have already finished, keeps the ones still ahead", () => {
    const events = [at("past", "09:00", "09:30"), at("soon", "18:00", "19:00")];
    const feed = buildFeed({ tasks: [], events, goals: [], areas: [] }, "2026-05-24", "22:00");
    expect(feed).toHaveLength(0);
    const earlier = buildFeed({ tasks: [], events, goals: [], areas: [] }, "2026-05-24", "10:00");
    expect(earlier.map((n) => n.entityId)).toEqual(["soon"]);
  });

  it("keeps an event that is running right now", () => {
    const feed = buildFeed({ tasks: [], events: [at("live", "09:00", "10:00")], goals: [], areas: [] }, "2026-05-24", "09:30");
    expect(feed.map((n) => n.entityId)).toEqual(["live"]);
  });

  it("an event with no end is over once it has started: a point in time cannot still be upcoming", () => {
    const events = [at("pt", "09:00")];
    expect(buildFeed({ tasks: [], events, goals: [], areas: [] }, "2026-05-24", "09:01")).toHaveLength(0);
    expect(buildFeed({ tasks: [], events, goals: [], areas: [] }, "2026-05-24", "08:59")).toHaveLength(1);
  });

  it("without a clock the old all-day behaviour stands", () => {
    const feed = buildFeed({ tasks: [], events: [at("past", "09:00", "09:30")], goals: [], areas: [] }, "2026-05-24");
    expect(feed).toHaveLength(1);
  });
});

// LAW 2: the screen had no dismissal of any kind, so the same overdue rows
// greeted him every visit forever, clearable only by finishing the task.
describe("nudge dismissals", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };

  it("a dismissed nudge stops rendering, and tomorrow it asks again", () => {
    const s = store();
    const tasks = [T("1", "Pay invoice", "2026-05-01")];
    expect(buildFeed({ tasks, events: [], goals: [], areas: [] }, "2026-05-24")).toHaveLength(1);

    const ids = dismissNudge("ov-1", "2026-05-24", s);
    expect(buildFeed({ tasks, events: [], goals: [], areas: [] }, "2026-05-24", undefined, ids)).toHaveLength(0);

    // A new day is a new fact: the dismissal does not carry over.
    expect(loadNudgeDismissed("2026-05-25", s)).toEqual([]);
    expect(buildFeed({ tasks, events: [], goals: [], areas: [] }, "2026-05-25", undefined, loadNudgeDismissed("2026-05-25", s))).toHaveLength(1);
  });
});
