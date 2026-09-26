import { describe, it, expect } from "vitest";
import { buildWeek, weekDays, vsUsual } from "./week";
import type { WindowRow } from "../brain/window";
import type { EventItem } from "../schedule/types";
import type { Goal } from "../life/types";

// C-64 and C-65 (Astra, 2026-09-12).
const TODAY = "2026-09-12"; // a Saturday
const row = (type: string, day: string, over: Partial<WindowRow> = {}): WindowRow => ({ type, day, h: 10, category: null, n: null, flag: null, kind: null, ...over });
const ev = (id: string, date: string, start: string, end: string, category: string): EventItem => ({ id, data: { title: id, date, start, end, category } } as unknown as EventItem);
const CATS = [{ id: "bridge", name: "Bridge", color: "indigo" }, { id: "tucci", name: "Tucci", color: "teal" }];
const goal = (over: Partial<Goal["data"]>): Goal => ({ id: "g", data: { title: "Raise", state: "on_track", ...over } });

describe("weekDays", () => {
  it("is the seven days ending today, oldest first", () => {
    const d = weekDays(TODAY);
    expect(d.length).toBe(7);
    expect(d[0]).toBe("2026-09-06");
    expect(d[6]).toBe(TODAY);
  });
});

describe("buildWeek", () => {
  it("counts the week through computeSeal and says the five lines in counts", () => {
    const rows: WindowRow[] = [
      ...["2026-09-07", "2026-09-08", "2026-09-09"].map((d) => row("task.completed", d, { category: "bridge" })),
      row("task.completed", "2026-09-01", { category: "bridge" }), // last week: not counted
      row("task.pushed", "2026-09-10", { category: "tucci" }), row("task.pushed", "2026-09-11", { category: "tucci" }),
      row("schedule.override", "2026-09-10"),
      row("strand.created", "2026-09-11"),
      row("focus.completed", "2026-09-08"), row("focus.completed", "2026-09-09"),
      row("plan.picked", "2026-09-08", { n: 1, entity_id: "t1" }), row("plan.outcome", "2026-09-08", { n: 1, entity_id: "t1", flag: true }),
    ];
    const events = [ev("e1", "2026-09-08", "09:00", "12:00", "bridge"), ev("e2", "2026-09-09", "09:00", "17:00", "tucci"), ev("e3", "2026-09-10", "09:00", "15:00", "tucci")];
    const w = buildWeek({ today: TODAY, rows, events, workouts: [], goals: [goal({ tags: ["bridge"], achievedOn: "2026-09-10" })], projects: [], categories: CATS });
    expect(w.tiles.done).toBe(3);
    expect(w.tiles.moved).toBe(1);
    expect(w.tiles.flexible).toBe("23h");
    expect(w.stack!.map((s) => s.name)).toEqual(["Tucci", "Bridge", "Open"]);
    const byKey = Object.fromEntries(w.lines.map((l) => [l.key, l.facts.map((f) => f.text)]));
    expect(byKey.Worked).toEqual(["1 of 1 Plans landed", "Focus held 2 days"]);
    expect(byKey.Slipped).toEqual(["Tucci · 2 Tasks pushed"]);
    expect(byKey.Changed).toEqual(["1 Block moved"]);
    expect(byKey.Learned).toEqual(["1 New fact"]);
    // Purple is not in the Colour Key (§AM): Learned is the caps grey, and
    // what JARVIS learned is the line's one grey fact.
    const learnedLine = w.lines.find((l) => l.key === "Learned")!;
    expect(learnedLine.tone).toBe("quiet");
    expect(learnedLine.facts[0]?.tone).toBeUndefined();
    // The count is a number with no state, so it is white (a <b> part).
    expect(learnedLine.facts[0]?.parts).toEqual([{ b: "1" }, " New fact"]);
    // Changed is the caps grey and blocks moved its one grey fact; sky is
    // retired (§AM).
    const changedLine = w.lines.find((l) => l.key === "Changed")!;
    expect(changedLine.tone).toBe("quiet");
    expect(changedLine.facts[0]?.tone).toBeUndefined();
    expect(byKey.Next).toEqual(["Bridge 3h of 17h"]);
    // Next is amber: "needs you soon" in the key, never the red of late.
    expect(w.lines.find((l) => l.key === "Next")!.tone).toBe("warn");
    for (const l of w.lines) expect(["good", "warn", "quiet"]).toContain(l.tone);
    expect(w.next?.name).toBe("Bridge");
    expect(w.offer).toBe(true);
    // No percent anywhere but the one C-65 allows, and that one is absent
    // without last week to compare against.
    for (const l of w.lines) for (const f of l.facts) expect(f.text).not.toMatch(/%/);
  });

  it("Changed: blocks moved is the one grey, a check-in is logged (green)", () => {
    const rows: WindowRow[] = [row("schedule.override", "2026-09-10"), row("schedule.override", "2026-09-11"), row("goal.checkin", "2026-09-10")];
    const w = buildWeek({ today: TODAY, rows, events: [], workouts: [], goals: [], projects: [], categories: CATS });
    const changed = w.lines.find((l) => l.key === "Changed")!;
    expect(changed.facts.map((f) => [f.text, f.tone])).toEqual([["2 Blocks moved", undefined], ["1 Check-in", "good"]]);
  });

  it("Learned is one fact: new facts and remembered together, counts white, no colour", () => {
    const rows: WindowRow[] = [row("strand.created", "2026-09-10"), row("strand.created", "2026-09-11"), row("strand.starred", "2026-09-11")];
    const w = buildWeek({ today: TODAY, rows, events: [], workouts: [], goals: [], projects: [], categories: CATS });
    const learned = w.lines.find((l) => l.key === "Learned")!;
    expect(learned.facts).toHaveLength(1);
    expect(learned.facts[0]).toEqual({ text: "2 New facts, 1 remembered", parts: [{ b: "2" }, " New facts, ", { b: "1" }, " remembered"] });
    const onlyStarred = buildWeek({ today: TODAY, rows: [row("strand.starred", "2026-09-11")], events: [], workouts: [], goals: [], projects: [], categories: CATS });
    expect(onlyStarred.lines.find((l) => l.key === "Learned")!.facts[0]?.text).toBe("1 Remembered");
  });

  it("C-65: the vs-usual fact appears only in a report line, only when the share moved", () => {
    expect(vsUsual(26, 35)).toBe("26% vs usual 35%");
    expect(vsUsual(33, 35)).toBeNull();
    expect(vsUsual(26, null)).toBeNull();
    const prevRows: WindowRow[] = [];
    const events = [ev("e1", "2026-09-08", "09:00", "12:00", "bridge"), ev("e2", "2026-09-09", "09:00", "17:00", "tucci"), ev("p1", "2026-09-02", "09:00", "17:00", "bridge"), ev("p2", "2026-09-03", "09:00", "11:00", "tucci")];
    const w = buildWeek({ today: TODAY, rows: [], prevRows, events, workouts: [], goals: [goal({ tags: ["bridge"] })], projects: [], categories: CATS });
    const next = w.lines.find((l) => l.key === "Next")!;
    expect(next.facts[1]?.text).toBe("27% vs usual 80%");
    expect(next.facts[1]?.tone).toBe("warn");
  });

  it("a quiet week is quiet: no lines, no stack, no offer", () => {
    const w = buildWeek({ today: TODAY, rows: [], events: [], workouts: [], goals: [], projects: [], categories: CATS });
    expect(w.lines).toEqual([]);
    expect(w.stack).toBeNull();
    expect(w.offer).toBe(false);
    expect(w.tiles).toEqual({ done: 0, moved: 0, flexible: "40h" });
  });
});
