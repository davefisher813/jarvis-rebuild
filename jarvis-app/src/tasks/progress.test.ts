import { describe, it, expect } from "vitest";
import { WORKED_CAP, WORKED_DUPLICATE_MS, addWorked, lastWorked, stepCounts, whenWorked } from "./progress";
import type { TaskData } from "../notes/types";

describe("stepCounts", () => {
  it("counts the task's own steps and ignores blank lines", () => {
    expect(stepCounts([{ text: "a", done: true }, { text: "b", done: false }, { text: "  ", done: false }])).toEqual({ done: 1, total: 2 });
  });
  it("no steps is zero of zero", () => {
    expect(stepCounts(undefined)).toEqual({ done: 0, total: 0 });
  });
});

describe("addWorked (partial progress, kept apart from completion)", () => {
  const t0 = new Date("2026-10-04T10:00:00Z");

  it("adds an entry with the note", () => {
    const r = addWorked(undefined, "  drafted the intro ", t0);
    expect(r.changed).toBe(true);
    expect(r.list).toEqual([{ at: t0.toISOString(), note: "drafted the intro" }]);
  });

  it("a note is optional", () => {
    expect(addWorked([], undefined, t0).list).toEqual([{ at: t0.toISOString() }]);
    expect(addWorked([], "   ", t0).list).toEqual([{ at: t0.toISOString() }]);
  });

  it("the same tap arriving twice inside the window is one entry", () => {
    const first = addWorked([], "same", t0);
    const again = addWorked(first.list, "same", new Date(t0.getTime() + WORKED_DUPLICATE_MS - 1));
    expect(again.changed).toBe(false);
    expect(again.list).toHaveLength(1);
  });

  it("after the window, or with a different note, it is new work", () => {
    const first = addWorked([], "same", t0);
    expect(addWorked(first.list, "same", new Date(t0.getTime() + WORKED_DUPLICATE_MS + 1)).changed).toBe(true);
    expect(addWorked(first.list, "other", new Date(t0.getTime() + 1)).changed).toBe(true);
  });

  it("keeps the list bounded", () => {
    let list = [] as ReturnType<typeof addWorked>["list"];
    for (let i = 0; i < WORKED_CAP + 10; i++) list = addWorked(list, `n${i}`, new Date(t0.getTime() + i * 60_000)).list;
    expect(list).toHaveLength(WORKED_CAP);
    expect(list[list.length - 1]!.note).toBe(`n${WORKED_CAP + 9}`);
  });

  it("lastWorked reads the newest", () => {
    const data = { text: "x", category: "", done: false, worked: [{ at: "a" }, { at: "b", note: "n" }] } as TaskData;
    expect(lastWorked(data)).toEqual({ at: "b", note: "n" });
    expect(lastWorked({ text: "x", category: "", done: false } as TaskData)).toBeNull();
  });
});

describe("whenWorked", () => {
  it("says a plain fact about when", () => {
    expect(whenWorked("2026-10-04T08:00:00Z", "2026-10-04")).toBe("Today");
    expect(whenWorked("2026-10-03T08:00:00Z", "2026-10-04")).toBe("Yesterday");
    expect(whenWorked("2026-10-01T08:00:00Z", "2026-10-04")).toBe("3 Days Ago");
  });
  it("a bad date is Recently, never a scold", () => {
    expect(whenWorked("nope", "2026-10-04")).toBe("Recently");
  });
});
