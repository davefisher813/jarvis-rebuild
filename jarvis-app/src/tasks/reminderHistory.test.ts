import { describe, it, expect } from "vitest";
import type { ReminderInfo, ReminderEvent } from "../notes/types";
import { actionLabelFor, describeEvent, recentEvents, scheduleAdvice, snoozeRun, adviceLine, whenOf, COMPLETIONS_FOR_ADVICE } from "./reminderHistory";

// WHAT A REMINDER IS ABOUT, AND WHAT HAPPENED TO IT (the reminders rebuild
// push C). The verb per linked type, history in words, and advice that is
// evidence offered, never a change made.
const TUE = "2026-09-15";
const ev = (kind: ReminderEvent["kind"], at: string, meta?: Record<string, unknown>): ReminderEvent => (meta ? { at, kind, meta } : { at, kind });

describe("actionLabelFor", () => {
  it("names the verb that opens the thing", () => {
    expect(actionLabelFor({ type: "task", id: "t" })).toBe("Open Task");
    expect(actionLabelFor({ type: "email", id: "e" })).toBe("Open Conversation");
    expect(actionLabelFor({ type: "decision", id: "d" })).toBe("Review Decision");
    expect(actionLabelFor({ type: "healthItem", id: "h" })).toBe("Log It");
  });
});

describe("history in words", () => {
  it("says each event and when", () => {
    expect(describeEvent(ev("completed", `${TUE}T09:05:00`), TUE)).toEqual({ word: "Done", when: "Today, 9:05 AM" });
    expect(describeEvent(ev("snoozed", `${TUE}T09:05:00`, { to: "09:15" }), TUE).word).toBe("Snoozed to 9:15 AM");
    expect(describeEvent(ev("rescheduled", `${TUE}T09:05:00`, { time: "14:30" }), TUE).word).toBe("Moved to 2:30 PM");
    expect(describeEvent(ev("skipped", "2026-09-14T09:05:00"), TUE).when).toBe("Yesterday, 9:05 AM");
    expect(describeEvent(ev("keptSchedule", "2026-09-01T09:05:00"), TUE)).toEqual({ word: "Kept the Schedule", when: "Tue, Sep 1, 9:05 AM" });
    expect(whenOf("not a date", TUE)).toBe("");
  });
  it("recentEvents is newest first and capped", () => {
    const r: ReminderInfo = { time: "09:00", history: [ev("completed", "2026-09-10T09:00:00"), ev("snoozed", "2026-09-11T09:00:00"), ev("completed", "2026-09-12T09:00:00")] };
    expect(recentEvents(r, TUE, 2).map((x) => x.word)).toEqual(["Done", "Snoozed"]);
  });
});

describe("scheduleAdvice", () => {
  it("three snoozes running is evidence; a completion, a skip, a move or Keep Schedule ends the run", () => {
    const three: ReminderInfo = { time: "09:00", history: [ev("snoozed", "a"), ev("snoozed", "b"), ev("snoozed", "c")] };
    expect(snoozeRun(three)).toBe(3);
    expect(scheduleAdvice(three)).toEqual({ kind: "snoozes", count: 3 });
    expect(adviceLine(scheduleAdvice(three))).toBe("Snoozed the last 3 times · Choose a better time?");
    expect(scheduleAdvice({ ...three, history: [...three.history!, ev("keptSchedule", "d")] })).toBeNull();
    expect(scheduleAdvice({ ...three, history: [...three.history!, ev("completed", "d")] })).toBeNull();
    expect(scheduleAdvice({ time: "09:00", history: [ev("snoozed", "a"), ev("snoozed", "b")] })).toBeNull();
  });
  it("eight completions landing half an hour late suggest the time they actually happen", () => {
    const hist = Array.from({ length: COMPLETIONS_FOR_ADVICE }, (_, i) => ev("completed", `2026-09-0${(i % 9) + 1}T09:4${i % 3}:00`));
    const r: ReminderInfo = { time: "09:00", history: hist };
    expect(scheduleAdvice(r)).toEqual({ kind: "later", time: "09:40" });
    expect(adviceLine(scheduleAdvice(r))).toBe("Usually done around 9:40 AM · Move it there?");
  });
  it("seven completions, or completions on time, say nothing", () => {
    const seven = Array.from({ length: COMPLETIONS_FOR_ADVICE - 1 }, (_, i) => ev("completed", `2026-09-0${i + 1}T09:45:00`));
    expect(scheduleAdvice({ time: "09:00", history: seven })).toBeNull();
    const onTime = Array.from({ length: COMPLETIONS_FOR_ADVICE }, (_, i) => ev("completed", `2026-09-0${(i % 9) + 1}T09:10:00`));
    expect(scheduleAdvice({ time: "09:00", history: onTime })).toBeNull();
  });
  it("advice once declined is not repeated on the same evidence", () => {
    const hist = Array.from({ length: COMPLETIONS_FOR_ADVICE }, (_, i) => ev("completed", `2026-09-0${(i % 9) + 1}T09:45:00`));
    expect(scheduleAdvice({ time: "09:00", history: [...hist, ev("keptSchedule", "2026-09-10T09:00:00")] })).toBeNull();
  });
  it("never advises an unscheduled or paused reminder", () => {
    const hist = [ev("snoozed", "a"), ev("snoozed", "b"), ev("snoozed", "c")];
    expect(scheduleAdvice({ time: "09:00", scheduleKind: "unscheduled", history: hist })).toBeNull();
    expect(scheduleAdvice({ time: "09:00", paused: true, history: hist })).toBeNull();
  });
});
