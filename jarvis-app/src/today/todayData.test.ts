// @vitest-environment jsdom
// ISSUE 112 (ruling 18, Dave 2026-10-13): with the Email flag on, a task that came from an email is an ordinary task on
// Today. The Tasks setting (tasks/emailTasks.ts, Dave 2026-09-13) keeps an open email task out of Today and Overdue by
// default, so with the Email band no longer drawing it the approved task would have been on no Today list while the day
// ring and the badge still counted it. todaysTasks and daySummary take `emailAsNormal`, the names of the email-born tasks
// that join the lists; without it nothing changes.
import { describe, it, expect, beforeEach } from "vitest";
import { daySummary, dayRing, todaysTasks } from "./todayData";
import { SETTING_EMAIL_TASKS, writeMirror } from "../data/SettingsService";
import type { TaskItem } from "../tasks/TasksService";

const TODAY = "2026-10-13";
const stamp = { type: "email" as const, ref: "thread-1", ts: 1 };
const task = (id: string, data: Partial<TaskItem["data"]>): TaskItem => ({ id, data: { text: id, category: "", done: false, ...data } as TaskItem["data"] });
// What TodayFlow passes: the email source stamp a capture the person approved writes.
const normal = (t: TaskItem): boolean => t.data.source?.type === "email";
const ids = (list: TaskItem[]) => list.map((t) => t.id);

const items = [
  task("plain", { due: TODAY }),
  task("approved", { due: TODAY, fromThread: "thread-1", source: stamp }),
  task("approvedLate", { due: "2026-10-11", fromThread: "thread-2", source: stamp }),
  task("approvedLater", { due: "2026-10-20", fromThread: "thread-3", source: stamp }),
  task("approvedDone", { due: TODAY, done: true, fromThread: "thread-4", source: stamp }),
  task("threadOnly", { due: TODAY, fromThread: "thread-5" }),
  task("getBackTo", { text: "Get back to the dentist", due: TODAY }),
];

beforeEach(() => { localStorage.clear(); });

describe("todaysTasks and daySummary: an email-born task on Today (issue 112)", () => {
  it("without emailAsNormal nothing changes: the Tasks setting keeps every open email task out of the Today lists", () => {
    expect(ids(todaysTasks(items, TODAY))).toEqual(["plain", "getBackTo"]);
    const s = daySummary([], items, TODAY);
    expect([s.due, s.overdue]).toEqual([2, 0]);
  });

  it("with emailAsNormal, an open approved email task joins Today and Overdue even though the setting says From Email", () => {
    expect(ids(todaysTasks(items, TODAY, normal))).toEqual(["approvedLate", "plain", "approved", "getBackTo"]);
    const s = daySummary([], items, TODAY, 0, normal);
    expect([s.due, s.overdue]).toEqual([3, 1]);
  });

  it("overdue leads, a later due date and a finished task stay off, and a plain task is untouched", () => {
    const listed = ids(todaysTasks(items, TODAY, normal));
    expect(listed[0]).toBe("approvedLate");
    expect(listed).not.toContain("approvedLater");
    expect(listed).not.toContain("approvedDone");
    expect(listed).toContain("plain");
  });

  it("an email-born task it does not name (a thread link and no email stamp) stays where the setting puts it", () => {
    expect(ids(todaysTasks(items, TODAY, normal))).not.toContain("threadOnly");
    expect(daySummary([], items, TODAY, 0, normal).due).toBe(3);
  });

  it("with the Tasks setting at the main list, what it does not name joins as it always did", () => {
    writeMirror(SETTING_EMAIL_TASKS, { value: "list", updatedAt: 1 });
    expect(ids(todaysTasks(items, TODAY))).toEqual(["approvedLate", "plain", "approved", "threadOnly", "getBackTo"]);
    expect(ids(todaysTasks(items, TODAY, normal))).toEqual(["approvedLate", "plain", "approved", "threadOnly", "getBackTo"]);
  });

  it("the list and the summary agree with the day ring, which has always counted an email task due today", () => {
    const approvedOnly = [task("approved", { due: TODAY, fromThread: "thread-1", source: stamp })];
    expect(dayRing(approvedOnly, TODAY).total).toBe(1);
    expect(todaysTasks(approvedOnly, TODAY).length).toBe(0);
    expect(todaysTasks(approvedOnly, TODAY, normal).length).toBe(1);
    expect(daySummary([], approvedOnly, TODAY, 0, normal).due).toBe(dayRing(approvedOnly, TODAY).total);
  });

  it("the Tasks tab's own lists are not changed by any of this: partition still diverts an open email task by default", async () => {
    const { partition } = await import("../tasks/filters");
    expect(ids(partition(items, TODAY).today)).toEqual(["plain", "getBackTo"]);
    expect(ids(partition(items, TODAY).email)).toContain("approved");
  });
});
