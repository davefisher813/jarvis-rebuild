import { describe, it, expect } from "vitest";
import { buildFeed } from "./feed";
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
