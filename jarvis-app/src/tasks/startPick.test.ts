import { describe, it, expect } from "vitest";
import { topPick, startReason } from "./startPick";
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
      T("spare", "And another", { due: "2026-09-30" }),
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
      T("open", "Something else", { due: TODAY }),
      T("spare", "And another", { due: "2026-09-30" }),
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

  // THE TWO GATES (Dave 2026-09-18: "if we are going to highlight one thing
  // like that the logic better be flawless or else it's just random
  // nonsense"). He was looking at a card proposing the only task on the list,
  // which the row beneath it was already offering with its own Start button.
  it("will not highlight the only thing there is", () => {
    expect(topPick([T("a", "File LLC", { due: "2026-09-01" })], TODAY), "one of one is not a choice").toBeNull();
    const two = [T("a", "File LLC", { due: "2026-09-01" }), T("b", "Second", { due: "2026-09-02" })];
    expect(topPick(two, TODAY)?.task.id).toBe("a");
  });

  // rankOpen keys every undated task to the same bucket, so among undated
  // work "the top one" is whichever the array happened to hold first. The old
  // card picked it anyway and explained itself with "nothing else is closer
  // to due" -- which was true of every other task on the list too.
  it("makes no pick at all when nothing is ahead on a date", () => {
    expect(topPick([T("a", "File LLC"), T("b", "Create the agent family"), T("c", "Book the venue")], TODAY)).toBeNull();
    // One dated task among undated ones IS a reason, and it leads.
    const mixed = [T("a", "File LLC"), T("b", "Book the venue", { due: TODAY }), T("c", "Third")];
    expect(topPick(mixed, TODAY)?.task.id).toBe("b");
  });

  // AHEAD MEANS AHEAD OF THE NEXT ONE. Two tasks due the same day are not
  // separated by anything, so whichever the array held first was the pick --
  // the same arbitrariness as undated work, wearing a date.
  it("makes no pick when the top two are level", () => {
    expect(topPick([T("a", "One", { due: TODAY }), T("b", "Two", { due: TODAY })], TODAY), "both due today").toBeNull();
    expect(topPick([T("a", "One", { due: "2026-09-10" }), T("b", "Two", { due: "2026-09-10" })], TODAY), "both late by the same day").toBeNull();
    // One day between them is separation enough, because he put it there.
    expect(topPick([T("a", "One", { due: "2026-09-10" }), T("b", "Two", { due: "2026-09-11" })], TODAY)?.task.id).toBe("a");
  });

  // The one exemption from the date gate: his own saved work is his decision,
  // not a judgement the app made.
  it("still resumes undated work he was in the middle of", () => {
    const tasks = [T("a", "File LLC"), T("mid", "Half written")];
    const sessions = { mid: { entityId: "mid", kind: "prepare_draft" as const, draft: "Hi everyone", savedAt: 10 } };
    const p = topPick(tasks, TODAY, sessions);
    expect(p?.task.id).toBe("mid");
    expect(p?.resuming).toBe(true);
  });

  it("choosing another hides one for the visit and writes nothing", () => {
    const tasks = [T("a", "First", { due: "2026-09-01" }), T("b", "Second", { due: "2026-09-02" }), T("c", "Third", { due: "2026-09-03" })];
    expect(topPick(tasks, TODAY, {}, { skip: ["a"] })?.task.id).toBe("b");
    // The task is untouched: hiding is a view.
    expect(tasks[0]!.data.done).toBe(false);
    expect(tasks[0]!.data.due).toBe("2026-09-01");
  });

});

describe("startReason: one line, and you can go and check it", () => {
  it("states the real date distance", () => {
    // capAfterNumber is the app's own convention for a line that opens on a
    // number, the same one the distance chips already wear.
    expect(startReason({ task: T("a", "Send practice details", { due: "2026-09-14" }), resuming: false }, TODAY)).toBe("2 Days late");
  });

  it("says he was already working on it when that is why", () => {
    expect(startReason({ task: T("a", "x", { due: "2026-09-14" }), resuming: true }, TODAY)).toBe("You were already working on it");
  });

  // The line it used to give here was "Nothing else is closer to due", which
  // was true of every undated task on the list. topPick will not make such a
  // pick any more, so the reason has nothing left to invent.
  it("invents nothing for a task with no date", () => {
    expect(startReason({ task: T("a", "Create AI agent family"), resuming: false }, TODAY)).toBe("");
  });

  it("due today and due soon read as themselves", () => {
    expect(startReason({ task: T("a", "x", { due: TODAY }), resuming: false }, TODAY)).toBe("Due today");
    expect(startReason({ task: T("b", "x", { due: "2026-09-17" }), resuming: false }, TODAY)).toBe("Due in 1 day");
    expect(startReason({ task: T("c", "x", { due: "2026-09-23" }), resuming: false }, TODAY)).toBe("Due in 7 days");
  });

  it("no urgency, mood or energy anywhere in it", () => {
    const lines = [
      startReason({ task: T("a", "x", { due: "2026-09-01" }), resuming: false }, TODAY),
      startReason({ task: T("b", "x"), resuming: true }, TODAY),
    ].join(" ");
    expect(lines).not.toMatch(/urgent|important|you should|energy|mood/i);
  });
});
