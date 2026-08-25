import { describe, it, expect } from "vitest";
import { openMinutes, loadOf, loadLine, dropToFit, dropLine, hhmm, autoSelect } from "./planLoad";
import { capOffer, finishRate } from "./planCap";
import { splitSittings, splitLine } from "./splitSitting";
import { dayClock } from "./planClock";
import { saveShape, loadShapes, dayScores, planCount, shapeOffer, applyShape, type DayShape } from "./dayShape";
import type { EventItem } from "./types";
import type { PlanCandidate } from "./screens/PlanDaySheet";
import { ScheduleService } from "./ScheduleService";

const ev = (id: string, start: string, end?: string): EventItem =>
  ({ id, data: { title: id, date: "2026-08-20", start, ...(end ? { end } : {}) } } as unknown as EventItem);

// 9:00 to 17:00
const S = 9 * 60, E = 17 * 60;

describe("the day's load", () => {
  it("counts free minutes around real events", () => {
    expect(openMinutes([], [], S, E)).toBe(480);
    expect(openMinutes([ev("a", "10:00", "11:00")], [], S, E)).toBe(420);
  });

  it("hard protected time is busy", () => {
    expect(openMinutes([], [{ s: 10 * 60, e: 11 * 60, label: "Gym" }], S, E)).toBe(420);
  });

  it("a focus block is OPEN time: it is where picks are meant to go", () => {
    expect(openMinutes([], [{ s: 13 * 60, e: 17 * 60, label: "Deep Work", kind: "focus" }], S, E)).toBe(480);
  });

  it("meals stay open: 'no time because dinner exists' is a lie", () => {
    expect(openMinutes([], [{ s: 12 * 60, e: 13 * 60, label: "Lunch", soft: true }], S, E)).toBe(480);
  });

  it("overlapping busy ranges are not double counted", () => {
    // 10-12 and 11-13 is ONE three-hour block of busy, not five hours.
    expect(openMinutes([ev("a", "10:00", "12:00"), ev("b", "11:00", "13:00")], [], S, E)).toBe(300);
  });

  it("clips busy time to the planning window", () => {
    expect(openMinutes([ev("a", "07:00", "10:00")], [], S, E)).toBe(420);
  });

  it("reports a fitting day as fitting", () => {
    const l = loadOf([{ taskId: "t", text: "T", category: "", start: "09:00", end: "10:00" }], [], 480);
    expect(l).toMatchObject({ pickedMin: 60, overMin: 0, fits: true });
    expect(loadLine(l, 1)).toBe("8h open · 1 picked, fits");
  });

  it("an unplaced pick IS the over signal, not arithmetic", () => {
    const l = loadOf([], [{ durationMin: 90 }], 60);
    expect(l.overMin).toBe(90);
    expect(l.fits).toBe(false);
    expect(loadLine(l, 1)).toBe("1h open · 1h 30m over");
  });

  it("says nothing about picks when nothing is picked", () => {
    expect(loadLine(loadOf([], [], 250), 0)).toBe("4h 10m open");
  });

  it("drops the LAST picks, never the first: pick order is priority", () => {
    expect(dropToFit(["a", "b", "c"], () => 60, 90)).toEqual(["b", "c"]);
    expect(dropToFit(["a", "b", "c"], () => 60, 0)).toEqual([]);
  });

  it("names the drop honestly", () => {
    expect(dropLine(1)).toBe("One of These Won't Fit");
    expect(dropLine(2)).toBe("These 2 Won't Fit");
  });

  it("reads durations like a person", () => {
    expect(hhmm(45)).toBe("45m");
    expect(hhmm(120)).toBe("2h");
    expect(hhmm(250)).toBe("4h 10m");
  });
});

describe("the finish rate", () => {
  it("stays silent until there is enough evidence to be fair", () => {
    expect(finishRate({ picks: 3, done: 3 }, 1)).toBeNull();
    expect(capOffer({ picks: 3, done: 3 }, 1)).toBeNull();
  });

  it("never advises planning zero", () => {
    expect(finishRate({ picks: 20, done: 1 }, 10)).toBeNull();
  });

  it("turns the shame stat into an offer", () => {
    const o = capOffer({ picks: 21, done: 6 }, 3);
    expect(o).toEqual({ n: 2, title: "You Finish About Two a Day", sub: "Want me to plan for two and leave the rest?" });
  });

  it("rounds in the user's favour", () => {
    expect(finishRate({ picks: 20, done: 5 }, 10)).toBe(1); // 0.5 -> 1
  });
});

describe("splitting a long sitting", () => {
  it("leaves a reasonable block alone", () => {
    expect(splitSittings(45)).toEqual([45]);
    expect(splitSittings(120)).toEqual([120]);
  });

  it("splits three hours into two real sittings", () => {
    expect(splitSittings(180)).toEqual([90, 90]);
    expect(splitLine([90, 90])).toBe("2 Sittings · 90m each");
  });

  it("gives the remainder to the FIRST sitting, where the energy is", () => {
    const c = splitSittings(200);
    expect(c).toHaveLength(2);
    expect(c[0]).toBeGreaterThan(c[1]!);
    expect(c[0]! + c[1]!).toBe(200);
  });

  it("refuses to make fragments", () => {
    expect(splitSittings(70, 25)).toEqual([70]);
  });

  it("says nothing when there is no split", () => {
    expect(splitLine([45])).toBe("");
  });
});


describe("the clock check", () => {
  it("says nothing while the day still holds something real", () => {
    expect(dayClock(9 * 60, 17 * 60)).toBeNull();
  });

  it("calls out a day with thirty minutes left", () => {
    const v = dayClock(23 * 60, 23 * 60 + 30);
    expect(v?.title).toBe("Only 30 Minutes Left Today");
    expect(v?.spent).toBe(false);
    expect(v?.sub).toBe("Plan tomorrow instead?");
  });

  it("calls a dead day dead", () => {
    expect(dayClock(23 * 60 + 50, 24 * 60)?.spent).toBe(true);
    expect(dayClock(24 * 60, 23 * 60)?.leftMin).toBe(0);
  });
});

describe("the day shape", () => {
  const mem = () => {
    let v: string | null = null;
    return { getItem: () => v, setItem: (_k: string, s: string) => { v = s; } };
  };
  const shape = (day: string, dow: number, slots = [{ startMin: 540, min: 60 }]): DayShape => ({ day, dow, slots });

  it("round-trips and replaces same-day", () => {
    const st = mem();
    saveShape(shape("2026-08-18", 2), st);
    saveShape(shape("2026-08-18", 2, [{ startMin: 600, min: 30 }]), st);
    expect(loadShapes(st)).toHaveLength(1);
    expect(loadShapes(st)[0]!.slots[0]!.min).toBe(30);
  });

  it("refuses to store an empty shape", () => {
    const st = mem();
    saveShape({ day: "2026-08-18", dow: 2, slots: [] }, st);
    expect(loadShapes(st)).toEqual([]);
  });

  it("survives a corrupt store", () => {
    expect(loadShapes({ getItem: () => "{" })).toEqual([]);
  });

  it("scores days from the outcome log", () => {
    const log = [
      { type: "plan.outcome", props: { day: "2026-08-18", flag: true } },
      { type: "plan.outcome", props: { day: "2026-08-18", flag: true } },
      { type: "plan.outcome", props: { day: "2026-08-19", flag: false } },
      { type: "other", props: { day: "2026-08-19" } },
    ];
    expect(dayScores(log)).toEqual({
      "2026-08-18": { picks: 2, done: 2 },
      "2026-08-19": { picks: 1, done: 0 },
    });
    expect(planCount(log)).toBe(2);
  });

  it("an untagged outcome is unscoreable, never zero", () => {
    expect(dayScores([{ type: "plan.outcome", props: { flag: false } }])).toEqual({});
  });

  it("offers a day that measurably worked", () => {
    const o = shapeOffer(
      [shape("2026-08-18", 2), shape("2026-08-19", 3)],
      4, "2026-08-20",
      { "2026-08-18": { picks: 1, done: 1 }, "2026-08-19": { picks: 2, done: 1 } },
    );
    expect(o?.worked).toBe(true);
    expect(o?.title).toBe("Plan It Like Tuesday");
    expect(o?.shape.day).toBe("2026-08-18");
  });

  it("falls back to the same weekday, and says so instead of claiming it worked", () => {
    const o = shapeOffer([shape("2026-08-13", 4)], 4, "2026-08-20", {});
    expect(o?.worked).toBe(false);
    expect(o?.title).toBe("Same Shape as Last Thursday");
  });

  it("stays silent rather than handing him a Sunday rhythm for a Wednesday", () => {
    expect(shapeOffer([shape("2026-08-16", 0)], 3, "2026-08-20", {})).toBeNull();
    expect(shapeOffer([], 3, "2026-08-20", {})).toBeNull();
  });

  it("never offers today or the future as precedent", () => {
    expect(shapeOffer([shape("2026-08-20", 4)], 4, "2026-08-20", {})).toBeNull();
  });

  it("pours picks into the slots, in order", () => {
    const s = shape("2026-08-18", 2, [{ startMin: 540, min: 60 }, { startMin: 660, min: 30 }]);
    const { overrides, durations } = applyShape(s, ["a", "b", "c"], 480, 1020);
    expect(overrides).toEqual({ a: "09:00", b: "11:00" });
    expect(durations).toEqual({ a: 60, b: 30 });
  });

  it("will not push a block past today's window", () => {
    const s = shape("2026-08-18", 2, [{ startMin: 1200, min: 60 }]);
    const { overrides } = applyShape(s, ["a"], 540, 1020);
    expect(overrides).toEqual({ a: "16:00" }); // clamped to fit, not dropped off the end
  });
});

describe("plan it for me", () => {
  const ranked = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("fills the open time in rank order", () => {
    expect(autoSelect(ranked, 120, () => 45, null)).toEqual(["a", "b"]); // 3x45 overruns 2h
    expect(autoSelect(ranked, 140, () => 45, null)).toEqual(["a", "b", "c"]);
  });

  it("stops at the cap", () => {
    expect(autoSelect(ranked, 600, () => 30, 2)).toEqual(["a", "b"]);
  });

  it("never plans nothing when there is something", () => {
    expect(autoSelect(ranked, 10, () => 180, null)).toEqual(["a"]);
  });

  it("skips a block that will not fit and tries the next", () => {
    const dur = (id: string) => ({ a: 60, b: 240, c: 30 }[id] ?? 45);
    expect(autoSelect(ranked.slice(0, 3), 100, dur, null)).toEqual(["a", "c"]);
  });

  it("plans nothing out of nothing", () => {
    expect(autoSelect([], 480, () => 45, null)).toEqual([]);
  });
});

describe("the one event door (audit 2026-08-25)", () => {
  function doorSvc() {
    const events: { type: string; entityId?: string; props?: Record<string, unknown> }[] = [];
    const store = {
      listForUser: async () => [],
      create: async () => "e" + events.length,
      read: async () => null,
      update: async () => {},
      delete: async () => {},
    } as never;
    const svc = new ScheduleService(store, "u1", (e) => events.push(e as never));
    return { svc, events };
  }
  const BLOCKS = [
    { taskId: "t1", text: "Deep work", category: "work", start: "09:00", end: "10:30" },
    { taskId: "t2", text: "Calls", category: "work", start: "10:30", end: "11:00" },
  ];

  it("a day plan emits picks in order and a committed duration per block", async () => {
    const { svc, events } = doorSvc();
    await svc.commitPlan("2026-08-25", BLOCKS, undefined, { picks: ["t1", "t2"] });
    const picked = events.filter((e) => e.type === "plan.picked");
    expect(picked.map((e) => [e.entityId, e.props?.n])).toEqual([["t1", 1], ["t2", 2]]);
    const durs = events.filter((e) => e.type === "plan.duration_committed");
    expect(durs.map((e) => [e.entityId, e.props?.n])).toEqual([["t1", 90], ["t2", 30]]);
  });

  it("a single placement records its duration and never a pick", async () => {
    const { svc, events } = doorSvc();
    await svc.commitPlan("2026-08-25", [BLOCKS[0]!]);
    expect(events.filter((e) => e.type === "plan.picked")).toEqual([]);
    expect(events.filter((e) => e.type === "plan.duration_committed")).toHaveLength(1);
  });
});
