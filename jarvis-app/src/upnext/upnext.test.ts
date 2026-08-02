import { describe, it, expect } from "vitest";
import type { TaskItem } from "../tasks/TasksService";
import {
  rankOpen,
  pickNext,
  reasonFor,
  quickWins,
  isOffTrack,
  freshStartPlan,
  tomorrowOf,
  daysBetween,
} from "./upnext";

const T = "2026-07-30";
let n = 0;
function task(due: string | null, done = false, extra: Partial<TaskItem["data"]> = {}): TaskItem {
  n++;
  return { id: "t" + n, data: { text: "Task " + n, category: "", done, due, ...extra } };
}

describe("rankOpen / pickNext", () => {
  it("orders overdue (oldest first), then today, then upcoming, then no date", () => {
    const noDate = task(null);
    const today = task(T);
    const old = task("2026-07-20");
    const older = task("2026-07-10");
    const future = task("2026-08-04");
    const doneT = task(T, true);
    const ranked = rankOpen([noDate, today, old, future, older, doneT], T);
    expect(ranked.map((t) => t.id)).toEqual([older.id, old.id, today.id, future.id, noDate.id]);
  });

  it("keeps future-due recurring tasks out of the deck until their day", () => {
    const weeklyFuture = task("2026-08-03", false, { recurrence: "weekly" });
    const weeklyToday = task(T, false, { recurrence: "weekly" });
    const plain = task(null);
    const ranked = rankOpen([weeklyFuture, weeklyToday, plain], T);
    expect(ranked.map((t) => t.id)).toEqual([weeklyToday.id, plain.id]);
    expect(quickWins([weeklyFuture, plain], T).map((t) => t.id)).toEqual([plain.id]);
  });

  it("pickNext returns null with nothing open and skips move a card to the back", () => {
    expect(pickNext([task(T, true)], T)).toBeNull();
    const a = task("2026-07-20");
    const b = task(T);
    expect(pickNext([a, b], T)!.id).toBe(a.id);
    expect(pickNext([a, b], T, [a.id])!.id).toBe(b.id);
    // everything skipped: the deck wraps rather than dead-ending
    expect(pickNext([a, b], T, [a.id, b.id])!.id).toBe(a.id);
  });
});

describe("reasonFor", () => {
  it("explains without shame vocabulary", () => {
    expect(reasonFor(task("2026-07-29"), T, false)).toBe("Waiting since yesterday");
    expect(reasonFor(task("2026-07-25"), T, false)).toBe("Waiting 5 days");
    expect(reasonFor(task(T), T, false)).toBe("Due today");
    expect(reasonFor(task("2026-07-31"), T, false)).toBe("Due tomorrow");
    expect(reasonFor(task("2026-08-02"), T, false)).toBe("Due in 3 days");
    expect(reasonFor(task(null), T, false)).toBe("No deadline");
    expect(reasonFor(task(T), T, true)).toBe("Due today · your focus peak");
    expect(reasonFor(task("2026-07-25"), T, false)).not.toMatch(/overdue/i);
  });
});

describe("quickWins", () => {
  it("caps the run at five off the top of the deck", () => {
    const list = [task(T), task(T), task(T), task(T), task(T), task(T), task(T)];
    expect(quickWins(list, T)).toHaveLength(5);
  });
});

describe("isOffTrack", () => {
  const openDue = () => [task(T), task(T), task("2026-07-28")];
  it("needs afternoon, 3+ open due, and a low done ratio, all together", () => {
    expect(isOffTrack(openDue(), T, 12 * 60)).toBe(false); // morning: never
    expect(isOffTrack(openDue(), T, 14 * 60)).toBe(true);
    expect(isOffTrack([task(T), task(T)], T, 14 * 60)).toBe(false); // only 2 open
    // plenty done already: not off track
    expect(isOffTrack([...openDue(), task(T, true), task(T, true), task(T, true)], T, 14 * 60)).toBe(false);
  });
});

describe("freshStartPlan", () => {
  it("keeps the top three and moves the rest, never touching recurring tasks", () => {
    const a = task("2026-07-20");
    const b = task("2026-07-25");
    const c = task(T);
    const d = task(T);
    const e = task(T);
    const daily = task(T, false, { recurrence: "daily" });
    const future = task("2026-08-10");
    const plan = freshStartPlan([a, b, c, d, e, daily, future], T);
    expect(plan.keep.map((t) => t.id)).toEqual([a.id, b.id, c.id]);
    expect(plan.move.map((t) => t.id).sort()).toEqual([d.id, e.id].sort());
  });
});

describe("date helpers", () => {
  it("tomorrowOf and daysBetween handle month edges", () => {
    expect(tomorrowOf("2026-07-31")).toBe("2026-08-01");
    expect(daysBetween("2026-07-30", "2026-08-01")).toBe(2);
  });
});
