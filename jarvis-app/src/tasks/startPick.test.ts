import { describe, it, expect } from "vitest";
import { topPick, otherPicks, whyStart, NO_CLOCK_LINE } from "./startPick";
import { startAction, type StartTarget } from "./startAction";
import type { TaskItem } from "./TasksService";
import type { TaskData } from "../notes/types";

const TODAY = "2026-09-16";
const T = (id: string, text: string, data: Partial<TaskData> = {}): TaskItem =>
  ({ id, data: { text, category: "life", done: false, ...data } });

describe("topPick: which one, and never a made-up reason", () => {
  it("follows the app's own ranking, not a second opinion", () => {
    const tasks = [T("a", "No date"), T("b", "Due today", { due: TODAY }), T("c", "Late", { due: "2026-09-10" })];
    expect(topPick(tasks, TODAY)?.task.id).toBe("c");
  });

  it("blocked work is never offered as a place to begin", () => {
    const tasks = [
      T("blocked", "Confirm equipment order", { due: "2026-09-01", blockedBy: { what: "Waiting for a revised quote", since: "2026-09-14" } }),
      T("open", "Send practice details", { due: TODAY }),
    ];
    expect(topPick(tasks, TODAY)?.task.id).toBe("open");
  });

  it("what he was already in the middle of leads, and says so", () => {
    const tasks = [T("late", "Late thing", { due: "2026-09-01" }), T("mid", "Half written", { due: "2026-12-01" })];
    const sessions = { mid: { entityId: "mid", kind: "prepare_draft" as const, draft: "Hi everyone", savedAt: 10 } };
    const p = topPick(tasks, TODAY, sessions);
    expect(p?.task.id).toBe("mid");
    expect(p?.resuming).toBe(true);
    // And an empty workspace is not "in the middle of" anything.
    const empty = { mid: { entityId: "mid", kind: "prepare_draft" as const, draft: "   ", savedAt: 10 } };
    expect(topPick(tasks, TODAY, empty)?.task.id).toBe("late");
  });

  it("work saved against a task that is now blocked does not resurrect it", () => {
    const tasks = [
      T("mid", "Half written", { blockedBy: { what: "Waiting on the quote", since: TODAY } }),
      T("open", "Something else"),
    ];
    const sessions = { mid: { entityId: "mid", kind: "prepare_draft" as const, draft: "words", savedAt: 10 } };
    expect(topPick(tasks, TODAY, sessions)?.task.id).toBe("open");
  });

  it("nothing open is an honest null, never an encouraging card", () => {
    expect(topPick([], TODAY)).toBeNull();
    expect(topPick([T("d", "Done", { done: true })], TODAY)).toBeNull();
    // Everything blocked is also nothing to begin.
    expect(topPick([T("b", "Blocked", { blockedBy: { what: "x", since: TODAY } })], TODAY)).toBeNull();
  });

  it("choosing another hides one for the visit and writes nothing", () => {
    const tasks = [T("a", "First", { due: "2026-09-01" }), T("b", "Second", { due: "2026-09-02" })];
    expect(topPick(tasks, TODAY, {}, { skip: ["a"] })?.task.id).toBe("b");
    // The task is untouched: hiding is a view.
    expect(tasks[0]!.data.done).toBe(false);
    expect(tasks[0]!.data.due).toBe("2026-09-01");
  });

  it("otherPicks keeps blocked work visible, at the end, rather than hiding it", () => {
    const tasks = [
      T("a", "First", { due: "2026-09-01" }),
      T("b", "Blocked", { due: "2026-09-02", blockedBy: { what: "waiting", since: TODAY } }),
      T("c", "Third", { due: "2026-09-03" }),
    ];
    expect(otherPicks(tasks, TODAY, "a").map((t) => t.id)).toEqual(["c", "b"]);
  });
});

describe("whyStart: reasons you can go and check", () => {
  const action = (t: TaskItem) => startAction({ kind: "task", id: t.id, title: t.data.text, data: t.data } as StartTarget);

  it("states the real date distance and what is ready", () => {
    const t = T("a", "Send practice details", { due: "2026-09-14" });
    const why = whyStart({ task: t, resuming: false }, action(t), TODAY);
    // capAfterNumber is the app's own convention for a line that opens on a
    // number, the same one the distance chips already wear.
    expect(why[0]).toBe("2 Days late");
    expect(why[1]).toBe("Start the message");
  });

  it("says he was already working on it when that is why", () => {
    const t = T("a", "Send practice details", { due: "2026-09-14" });
    expect(whyStart({ task: t, resuming: true }, action(t), TODAY)[0]).toBe("You were already working on it");
  });

  it("a task with no date says the honest thing rather than inventing urgency", () => {
    const t = T("a", "Create AI agent family");
    const why = whyStart({ task: t, resuming: false }, action(t), TODAY);
    expect(why[0]).toBe("Nothing else is closer to due");
    expect(why.join(" ")).not.toMatch(/urgent|important|you should|energy|mood/i);
  });

  it("due today and due soon read as themselves", () => {
    const today = T("a", "x", { due: TODAY });
    expect(whyStart({ task: today, resuming: false }, action(today), TODAY)[0]).toBe("Due today");
    const soon = T("b", "x", { due: "2026-09-17" });
    expect(whyStart({ task: soon, resuming: false }, action(soon), TODAY)[0]).toBe("Due in 1 day");
    const week = T("c", "x", { due: "2026-09-23" });
    expect(whyStart({ task: week, resuming: false }, action(week), TODAY)[0]).toBe("Due in 7 days");
  });

  it("the promise under the reasons is the one the old button broke", () => {
    expect(NO_CLOCK_LINE).toContain("No clock starts");
    expect(NO_CLOCK_LINE).toContain("No dates change");
  });
});
