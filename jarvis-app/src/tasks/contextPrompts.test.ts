import { describe, it, expect } from "vitest";
import type { TaskItem } from "./TasksService";
import type { ReminderInfo } from "../notes/types";
import { promptsDue, shownNow, snoozedForADay, describeTrigger } from "./contextPrompts";

// CONTEXT TRIGGERS (push D): a prompt for what just happened, with a
// cooldown, a day's snooze, and never for a paused or done reminder.
const item = (r: ReminderInfo, id = "r1", done = false): TaskItem =>
  ({ id, data: { text: "Do Bridge work first", category: "c1", done, reminder: r } } as TaskItem);
const TUE = "2026-09-15";
const NOW = Date.parse("2026-09-15T09:00:00Z");
const onArea = (lastShownAt: string | null = null, cooldownMinutes = 240): ReminderInfo =>
  ({ time: "09:00", scheduleKind: "unscheduled", contextTrigger: { kind: "onOpenArea", targetId: "area-bridge", cooldownMinutes, lastShownAt } });

describe("promptsDue", () => {
  it("is due when its area opens, and only its area", () => {
    expect(promptsDue([item(onArea())], { areaId: "area-bridge" }, TUE, NOW)).toHaveLength(1);
    expect(promptsDue([item(onArea())], { areaId: "area-other" }, TUE, NOW)).toHaveLength(0);
    expect(promptsDue([item(onArea())], { completedTaskId: "t1" }, TUE, NOW)).toHaveLength(0);
  });
  it("is due after its task completes", () => {
    const r: ReminderInfo = { time: "09:00", contextTrigger: { kind: "afterCompleteTask", targetId: "t1", cooldownMinutes: 60, lastShownAt: null } };
    expect(promptsDue([item(r)], { completedTaskId: "t1" }, TUE, NOW)).toHaveLength(1);
    expect(promptsDue([item(r)], { completedTaskId: "t2" }, TUE, NOW)).toHaveLength(0);
  });
  it("keeps its cooldown", () => {
    const recent = onArea(new Date(NOW - 30 * 60_000).toISOString());
    const old = onArea(new Date(NOW - 5 * 60 * 60_000).toISOString());
    expect(promptsDue([item(recent)], { areaId: "area-bridge" }, TUE, NOW)).toHaveLength(0);
    expect(promptsDue([item(old)], { areaId: "area-bridge" }, TUE, NOW)).toHaveLength(1);
  });
  it("never prompts for a paused, done, or ticked reminder, or one with no target", () => {
    expect(promptsDue([item({ ...onArea(), paused: true })], { areaId: "area-bridge" }, TUE, NOW)).toHaveLength(0);
    expect(promptsDue([item(onArea(), "r1", true)], { areaId: "area-bridge" }, TUE, NOW)).toHaveLength(0);
    expect(promptsDue([item({ ...onArea(), lastDone: TUE })], { areaId: "area-bridge" }, TUE, NOW)).toHaveLength(0);
    const noTarget: ReminderInfo = { time: "09:00", contextTrigger: { kind: "onOpenArea", targetId: null, cooldownMinutes: 60, lastShownAt: null } };
    expect(promptsDue([item(noTarget)], { areaId: "area-bridge" }, TUE, NOW)).toHaveLength(0);
  });
});

describe("shown and snoozed", () => {
  const ct = onArea().contextTrigger!;
  it("Continue Anyway marks it shown now, so it is back after the cooldown", () => {
    const next = shownNow(ct, NOW);
    expect(promptsDue([item({ ...onArea(), contextTrigger: next })], { areaId: "area-bridge" }, TUE, NOW + 239 * 60_000)).toHaveLength(0);
    expect(promptsDue([item({ ...onArea(), contextTrigger: next })], { areaId: "area-bridge" }, TUE, NOW + 240 * 60_000)).toHaveLength(1);
  });
  it("Snooze This Prompt keeps it away until tomorrow, whatever the cooldown", () => {
    const next = snoozedForADay(ct, NOW);
    expect(promptsDue([item({ ...onArea(), contextTrigger: next })], { areaId: "area-bridge" }, TUE, NOW + 23 * 60 * 60_000)).toHaveLength(0);
    expect(promptsDue([item({ ...onArea(), contextTrigger: next })], { areaId: "area-bridge" }, TUE, NOW + 24 * 60 * 60_000)).toHaveLength(1);
  });
  it("says the trigger in words", () => {
    expect(describeTrigger(undefined)).toBe("Never");
    expect(describeTrigger(ct, "Bridge")).toBe("When I Open Bridge");
    expect(describeTrigger({ kind: "afterCompleteTask", targetId: "t1", cooldownMinutes: 60, lastShownAt: null })).toBe("After I Complete the Task");
  });
});
