import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { RoutineService } from "./RoutineService";
import { DEFAULT_ROUTINE, planEndMin, WIND_DOWN_MIN, ENTITY_ROUTINE, isOvernight, isWorkOutsideActive, wakeFromBrief, activeHoursFor, planWindowFor, protectedRangesFor, type ProtectedBlock } from "./types";
import { planDay } from "../schedule/planDay";

describe("RoutineService", () => {
  it("returns defaults before any setup", async () => {
    const svc = new RoutineService(new Store(new InMemoryAdapter()), "u1");
    expect(await svc.get()).toEqual(DEFAULT_ROUTINE);
  });

  it("saves and reloads, keeping a single record", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new RoutineService(store, "u1");
    await svc.save({ wakeMin: 6 * 60 });
    await svc.save({ sleepMin: 23 * 60 });
    const r = await svc.get();
    expect(r.wakeMin).toBe(6 * 60);
    expect(r.sleepMin).toBe(23 * 60);
    // unset fields fall back to defaults
    expect(r.workStartMin).toBe(DEFAULT_ROUTINE.workStartMin);
    expect((await store.listForUser("u1")).filter((i) => i.entityType === ENTITY_ROUTINE).length).toBe(1);
  });

  it("isolates routines per user", async () => {
    const store = new Store(new InMemoryAdapter());
    await new RoutineService(store, "u1").save({ wakeMin: 5 * 60 });
    expect((await new RoutineService(store, "u2").get()).wakeMin).toBe(DEFAULT_ROUTINE.wakeMin);
  });

  it("reports configured only after a save", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new RoutineService(store, "u1");
    expect(await svc.isConfigured()).toBe(false);
    await svc.save({ wakeMin: 6 * 60 });
    expect(await svc.isConfigured()).toBe(true);
  });
});

describe("soft notes (non-blocking hints)", () => {
  it("flags overnight only when sleep is at or before wake", () => {
    expect(isOvernight(DEFAULT_ROUTINE)).toBe(false);
    expect(isOvernight({ ...DEFAULT_ROUTINE, wakeMin: 22 * 60, sleepMin: 6 * 60 })).toBe(true);
    expect(isOvernight({ ...DEFAULT_ROUTINE, wakeMin: 8 * 60, sleepMin: 8 * 60 })).toBe(true);
  });

  it("flags work outside active hours on either boundary", () => {
    expect(isWorkOutsideActive(DEFAULT_ROUTINE)).toBe(false);
    expect(isWorkOutsideActive({ ...DEFAULT_ROUTINE, workStartMin: 5 * 60 })).toBe(true); // before wake
    expect(isWorkOutsideActive({ ...DEFAULT_ROUTINE, workEndMin: 23 * 60 })).toBe(true); // after sleep
  });
});

describe("weekend hours (day-aware window)", () => {
  const weekday = { ...DEFAULT_ROUTINE, wakeMin: 7 * 60, sleepMin: 22 * 60 };
  const withWeekend = { ...weekday, weekendDifferent: true, weekendWakeMin: 9 * 60, weekendSleepMin: 24 * 60 - 1 };

  it("uses weekday hours when weekend mode is off", () => {
    // Saturday = 6, but mode is off
    expect(activeHoursFor(weekday, 6)).toEqual({ wakeMin: 7 * 60, sleepMin: 22 * 60 });
  });

  it("uses weekend hours on Sat/Sun when enabled", () => {
    expect(activeHoursFor(withWeekend, 6).wakeMin).toBe(9 * 60); // Sat
    expect(activeHoursFor(withWeekend, 0).wakeMin).toBe(9 * 60); // Sun
  });

  it("keeps weekday hours mid-week even with weekend mode on", () => {
    expect(activeHoursFor(withWeekend, 3).wakeMin).toBe(7 * 60); // Wed
  });

  it("falls back to weekday values when an override field is missing", () => {
    // truly omit weekendWakeMin (DEFAULT_ROUTINE carries one, so build clean)
    const partial = { wakeMin: 7 * 60, sleepMin: 22 * 60, workStartMin: 9 * 60, workEndMin: 17 * 60, weekendDifferent: true };
    expect(activeHoursFor(partial, 6).wakeMin).toBe(7 * 60);
  });

  it("planWindowFor derives the end from the day's hours", () => {
    const sat = planWindowFor(withWeekend, 6);
    expect(sat.wakeMin).toBe(9 * 60);
    expect(sat.endMin).toBe(24 * 60 - 1 - WIND_DOWN_MIN);
  });
});

describe("wakeFromBrief (onboarding inference)", () => {
  it("converts a brief time into wake minutes", () => {
    expect(wakeFromBrief("06:00")).toBe(6 * 60);
    expect(wakeFromBrief("07:30")).toBe(7 * 60 + 30);
    expect(wakeFromBrief("08:00")).toBe(8 * 60);
  });
});

describe("planEndMin (window derivation)", () => {
  it("stops a wind-down buffer before bedtime", () => {
    expect(planEndMin({ ...DEFAULT_ROUTINE, sleepMin: 22 * 60 })).toBe(22 * 60 - WIND_DOWN_MIN);
  });

  it("never returns an end before wake + 1h, even with a too-early bedtime", () => {
    // Bed 30 minutes after waking: absurd but typable. The floor holds.
    const r = { wakeMin: 7 * 60, sleepMin: 7 * 60 + 30, workStartMin: 9 * 60, workEndMin: 17 * 60 };
    expect(planEndMin(r)).toBe(7 * 60 + 60);
  });

  // The 2:41 AM screenshot bug (2026-08-10). Bed at 1:00 AM with an 8:30 wake
  // used to collapse the WHOLE planning day to one hour ("open gaps before
  // 9:30 AM", every pick "No room"). A bedtime at or before wake is overnight:
  // the day now runs to 11:30 PM (midnight minus wind-down).
  it("treats a past-midnight bedtime as overnight, not as before wake", () => {
    const r = { wakeMin: 8 * 60 + 30, sleepMin: 60, workStartMin: 9 * 60, workEndMin: 22 * 60 };
    expect(planEndMin(r)).toBe(24 * 60 - WIND_DOWN_MIN); // 23:30 = 1410
  });

  it("treats sleep equal to wake as overnight too, matching isOvernight", () => {
    const r = { wakeMin: 7 * 60, sleepMin: 7 * 60, workStartMin: 9 * 60, workEndMin: 17 * 60 };
    expect(planEndMin(r)).toBe(1410); // 11:30 PM, not wake + 1h
  });

  it("planWindowFor carries the overnight fix through weekend hours", () => {
    const r = {
      wakeMin: 8 * 60 + 30, sleepMin: 60, workStartMin: 9 * 60, workEndMin: 22 * 60,
      weekendDifferent: true, weekendWakeMin: 10 * 60, weekendSleepMin: 2 * 60,
    };
    expect(planWindowFor(r, 3)).toEqual({ wakeMin: 8 * 60 + 30, endMin: 1410 }); // Wed
    expect(planWindowFor(r, 6)).toEqual({ wakeMin: 10 * 60, endMin: 1410 });     // Sat, bed 2 AM
  });

  it("midnight exactly still means a late night, capped before the day ends", () => {
    const r = { wakeMin: 8 * 60, sleepMin: 0, workStartMin: 9 * 60, workEndMin: 17 * 60 };
    expect(planEndMin(r)).toBe(1410);
  });
});

describe("protectedRangesFor (Phase 2)", () => {
  const gym: ProtectedBlock = { id: "g", label: "Gym", startMin: 6 * 60, endMin: 7 * 60, days: [1, 3, 5] };
  const lunch: ProtectedBlock = { id: "l", label: "Lunch", startMin: 12 * 60, endMin: 13 * 60, days: [0, 1, 2, 3, 4, 5, 6] };
  const r = { ...DEFAULT_ROUTINE, protectedBlocks: [lunch, gym] };

  it("returns only the blocks that apply on the given day, sorted by start", () => {
    // Monday (1): both gym and lunch apply, gym first.
    expect(protectedRangesFor(r, 1)).toEqual([
      { s: 6 * 60, e: 7 * 60, label: "Gym" },
      { s: 12 * 60, e: 13 * 60, label: "Lunch" },
    ]);
    // Tuesday (2): only lunch.
    expect(protectedRangesFor(r, 2)).toEqual([{ s: 12 * 60, e: 13 * 60, label: "Lunch" }]);
  });

  it("returns nothing when no blocks are set", () => {
    expect(protectedRangesFor(DEFAULT_ROUTINE, 1)).toEqual([]);
    expect(protectedRangesFor({ ...DEFAULT_ROUTINE, protectedBlocks: undefined }, 1)).toEqual([]);
  });

  it("drops malformed blocks so one bad entry cannot wipe the day", () => {
    const bad = { ...DEFAULT_ROUTINE, protectedBlocks: [
      { id: "x", label: "  ", startMin: 60, endMin: 120, days: [1] } as ProtectedBlock, // empty label
      { id: "y", label: "Backwards", startMin: 120, endMin: 60, days: [1] } as ProtectedBlock, // end <= start
      { id: "z", label: "Nap", startMin: 780, endMin: 840, days: [] } as ProtectedBlock, // no days
    ] };
    expect(protectedRangesFor(bad, 1)).toEqual([]);
  });
});

describe("planDay respects the routine window", () => {
  const task = (id: string, durationMin: number) => ({ id, text: id, category: "", durationMin });

  it("places nothing after the derived end time", () => {
    // window 9:00 to 9:50 (sleep 10:20 minus 30 wind-down would be wider, so
    // pass an explicit tight end to prove the cutoff is honored).
    const plan = planDay([task("a", 30), task("b", 30)], [], 9 * 60, 9 * 60 + 50, 10);
    // first 30-min block fits 9:00-9:30; the second needs 9:40-10:10, past end.
    expect(plan.blocks.length).toBe(1);
    expect(plan.unplaced.map((t) => t.id)).toContain("b");
  });

  it("uses the full routine-derived window when it is wide", () => {
    const end = planEndMin(DEFAULT_ROUTINE); // 21:30
    const plan = planDay([task("a", 60)], [], DEFAULT_ROUTINE.wakeMin, end, 10);
    expect(plan.blocks.length).toBe(1);
    expect(plan.unplaced.length).toBe(0);
  });

  // Dave's 2:41 AM screenshot, end to end: wake 8:30, bed 1:00 AM, work 9 to
  // 10 PM, a hard Gym block, four flexible meals-and-focus blocks, three
  // 45-minute picks. Before the overnight fix the window was 8:30 to 9:30 and
  // every pick read "No room" over an empty day. Now everything places.
  it("plans a full day for an overnight sleeper (the No-room screenshot)", () => {
    const r = {
      wakeMin: 8 * 60 + 30, sleepMin: 60, workStartMin: 9 * 60, workEndMin: 22 * 60,
      protectedBlocks: [
        { id: "g", label: "Gym", startMin: 600, endMin: 690, days: [0, 1, 2, 3, 4, 5, 6] },
        { id: "b", label: "Breakfast", startMin: 540, endMin: 570, days: [0, 1, 2, 3, 4, 5, 6], soft: true },
        { id: "l", label: "Lunch", startMin: 750, endMin: 795, days: [0, 1, 2, 3, 4, 5, 6], soft: true },
        { id: "d", label: "Deep Work", startMin: 840, endMin: 960, days: [0, 1, 2, 3, 4, 5, 6], soft: true },
        { id: "n", label: "Dinner", startMin: 1110, endMin: 1170, days: [0, 1, 2, 3, 4, 5, 6], soft: true },
      ] as ProtectedBlock[],
    };
    const win = planWindowFor(r, 1); // Monday
    expect(win).toEqual({ wakeMin: 510, endMin: 1410 });

    const ranges = protectedRangesFor(r, 1);
    const hard = ranges.filter((x) => !x.soft);
    const soft = ranges.filter((x) => x.soft).map((x) => ({ s: x.s, e: x.e, label: x.label }));
    const picks = [
      { ...task("t1", 45), windowS: r.workStartMin, windowE: r.workEndMin },
      { ...task("t2", 45), windowS: r.workStartMin, windowE: r.workEndMin },
      { ...task("t3", 45), windowS: r.workStartMin, windowE: r.workEndMin },
    ];
    const plan = planDay(picks, [], win.wakeMin, win.endMin, 10, hard, soft);
    expect(plan.unplaced).toEqual([]);
    expect(plan.blocks.length).toBe(3);
    // None needed to land on a flexible block: the real day has plenty of room.
    expect(plan.blocks.every((b) => !b.overSoft && !b.outsideWindow)).toBe(true);
  });
});

// Routine enrichment (2026-08-09): kinds, locations, hard/soft, and the
// routine rendered as text for the one assembler.
import { routineToText, protectedRangesFor as rangesFor } from "./types";

describe("routineToText", () => {
  it("renders the four numbers the AI always had", () => {
    expect(routineToText(DEFAULT_ROUTINE)).toBe("Awake 7 AM to 10 PM; works 9 AM to 5 PM.");
  });

  it("renders the life around the work: meals, gym with a place, flexible hobbies", () => {
    const text = routineToText({
      ...DEFAULT_ROUTINE,
      protectedBlocks: [
        { id: "1", label: "Gym", startMin: 360, endMin: 420, days: [1, 3, 5], kind: "gym", location: "Cortland YMCA" },
        { id: "2", label: "Dinner", startMin: 1110, endMin: 1170, days: [0, 1, 2, 3, 4, 5, 6], kind: "meal", soft: true },
      ],
    });
    expect(text).toContain("Gym Mon Wed Fri 6 AM to 7 AM, at Cortland YMCA");
    expect(text).toContain("Dinner every day 6:30 PM to 7:30 PM, flexible");
  });

  it("drops malformed blocks instead of rendering nonsense", () => {
    const text = routineToText({
      ...DEFAULT_ROUTINE,
      protectedBlocks: [{ id: "1", label: "  ", startMin: 600, endMin: 500, days: [] }],
    });
    expect(text).toBe("Awake 7 AM to 10 PM; works 9 AM to 5 PM.");
  });
});

describe("protectedRangesFor soft flag", () => {
  it("carries soft through so the planner can split walls from preferences", () => {
    const r = {
      ...DEFAULT_ROUTINE,
      protectedBlocks: [
        { id: "1", label: "Gym", startMin: 360, endMin: 420, days: [1] },
        { id: "2", label: "Dinner", startMin: 1110, endMin: 1170, days: [1], soft: true },
      ],
    };
    const ranges = rangesFor(r, 1);
    expect(ranges.find((x) => x.label === "Gym")?.soft).toBeUndefined();
    expect(ranges.find((x) => x.label === "Dinner")?.soft).toBe(true);
  });
});
