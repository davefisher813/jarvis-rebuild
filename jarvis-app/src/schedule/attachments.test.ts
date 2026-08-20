import { describe, it, expect } from "vitest";
import { attachInfo, attachLabel, followUpCandidate } from "./attachments";
import type { EventItem } from "./types";
import type { TaskItem } from "../tasks/TasksService";

const D = "2026-07-31";
let n = 0;
function evt(over: Partial<EventItem["data"]> = {}): EventItem {
  return { id: "e" + ++n, data: { title: "Event " + n, date: D, start: "09:00", category: "", ...over } };
}
function task(id: string, done = false): TaskItem {
  return { id, data: { text: id, category: "", done } };
}

describe("attachInfo + attachLabel", () => {
  it("counts attached tasks and skips deleted ones", () => {
    const e = evt({ taskIds: ["a", "b", "gone"] });
    const info = attachInfo(e, [task("a", true), task("b")]);
    expect(info).toEqual({ total: 2, done: 1 });
    expect(attachLabel(info!)).toBe("1 of 2 Tasks done");
  });
  it("labels the none-done case without shame math", () => {
    expect(attachLabel({ total: 2, done: 0 })).toBe("2 Tasks attached");
    expect(attachLabel({ total: 1, done: 0 })).toBe("1 Task attached");
  });
  it("returns null with no surviving attachments", () => {
    expect(attachInfo(evt(), [])).toBeNull();
    expect(attachInfo(evt({ taskIds: ["gone"] }), [])).toBeNull();
  });
});

describe("followUpCandidate", () => {
  const tasks = [task("open1"), task("open2"), task("did", true)];
  it("offers the most recently ended event with open attached tasks", () => {
    const early = evt({ title: "Early", start: "09:00", end: "10:00", taskIds: ["open1"] });
    const late = evt({ title: "Late", start: "11:00", end: "12:00", taskIds: ["open2"] });
    const r = followUpCandidate([early, late], tasks, D, "13:00", new Set());
    expect(r).toMatchObject({ title: "Late", openCount: 1 });
  });
  it("skips events not ended, already asked, recurring, or all-done", () => {
    const notEnded = evt({ start: "12:00", end: "14:00", taskIds: ["open1"] });
    const askedE = evt({ start: "08:00", end: "09:00", taskIds: ["open1"] });
    const rec = evt({ start: "07:00", end: "08:00", taskIds: ["open1"], recurrence: "weekly" });
    const allDone = evt({ start: "06:00", end: "07:00", taskIds: ["did"] });
    expect(followUpCandidate([notEnded], tasks, D, "13:00", new Set())).toBeNull();
    expect(followUpCandidate([askedE], tasks, D, "13:00", new Set([askedE.id]))).toBeNull();
    expect(followUpCandidate([rec, allDone], tasks, D, "13:00", new Set())).toBeNull();
  });
  it("uses start+60 when an event has no end", () => {
    const e = evt({ start: "09:00", taskIds: ["open1"] });
    expect(followUpCandidate([e], tasks, D, "09:30", new Set())).toBeNull();
    expect(followUpCandidate([e], tasks, D, "10:00", new Set())).toMatchObject({ openCount: 1 });
  });
});
