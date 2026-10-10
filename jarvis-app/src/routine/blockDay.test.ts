import { describe, it, expect, vi, afterAll } from "vitest";
import {
  blockForDate, exceptionOn, protectedRangesOn, protectedRangesFor, splitProtectedRanges,
  type ProtectedBlock, type RoutineData, DEFAULT_ROUTINE,
} from "./types";
import {
  setBlockException, retimeBlockOn, skipBlockOn, pruneExceptions, editBlockBasics, shiftBlock, retimeBlock, resizeBlock,
  shiftBlockForDate, retimeBlockForDate, resizeBlockForDate,
} from "./blockAdjust";
import { planDay } from "../schedule/planDay";
import { openMinutes } from "../schedule/planLoad";
import { weekRowsFor } from "../schedule/weekRows";

// JUST THIS DAY (2026-10-01). A recurring protected block can carry per-date
// exceptions. These pin the resolver every reader goes through, the writers
// that keep the rule and the exceptions apart, and the readers that must
// honour it (the planner's capacity, the week).

const TODAY = "2026-10-01"; // a Thursday
const NEXT = "2026-10-02";  // the Friday after
const BF: ProtectedBlock = { id: "bf", label: "Breakfast", startMin: 9 * 60 + 30, endMin: 10 * 60 + 30, days: [0, 1, 2, 3, 4, 5, 6], kind: "meal", soft: true };
// The writers prune exceptions on past dates against the real clock, so the fixtures' day has to be today. Pinned
// (Date only) so these hold after 2026-10-01 too; unpinned, every check here went red on 2026-10-02.
// At load, not in a hook: some fixtures below are built while the file is collected.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-10-01T08:00:00"));
afterAll(() => { vi.useRealTimers(); });

const routineWith = (...blocks: ProtectedBlock[]): RoutineData => ({ ...DEFAULT_ROUTINE, protectedBlocks: blocks });

describe("blockForDate", () => {
  it("returns the block itself when the date has no exception (old data renders identically)", () => {
    expect(blockForDate(BF, TODAY)).toBe(BF);
    expect(exceptionOn(BF, TODAY)).toBeNull();
  });

  it("retimes: both ends replaced for that date", () => {
    const b = { ...BF, exceptions: { [TODAY]: { startMin: 11 * 60, endMin: 12 * 60 } } };
    expect(blockForDate(b, TODAY)).toMatchObject({ startMin: 660, endMin: 720, label: "Breakfast", kind: "meal" });
  });

  it("resizes: an end alone leaves the start on the rule", () => {
    const b = { ...BF, exceptions: { [TODAY]: { endMin: 11 * 60 } } };
    expect(blockForDate(b, TODAY)).toMatchObject({ startMin: 9 * 60 + 30, endMin: 660 });
  });

  it("skips: null for that date", () => {
    const b = { ...BF, exceptions: { [TODAY]: { skip: true } } };
    expect(blockForDate(b, TODAY)).toBeNull();
  });

  it("an exception on one date does not touch another", () => {
    const b = { ...BF, exceptions: { [TODAY]: { startMin: 660, endMin: 720 }, "2026-10-03": { skip: true } } };
    expect(blockForDate(b, NEXT)).toBe(b);
  });
});

describe("protectedRangesOn", () => {
  const retimed = routineWith({ ...BF, exceptions: { [TODAY]: { startMin: 11 * 60, endMin: 12 * 60 } } });
  const skipped = routineWith({ ...BF, exceptions: { [TODAY]: { skip: true } } });

  it("matches the day-of-week reader when nothing carries an exception", () => {
    const r = routineWith(BF, { id: "g", label: "Gym", startMin: 360, endMin: 420, days: [1, 3, 5] });
    const thursday = new Date(TODAY + "T12:00:00").getDay();
    expect(protectedRangesOn(r, TODAY)).toEqual(protectedRangesFor(r, thursday));
  });

  it("lays the day's times over the rule and marks the range justToday", () => {
    expect(protectedRangesOn(retimed, TODAY)).toEqual([expect.objectContaining({ s: 660, e: 720, id: "bf", justToday: true })]);
    // Another day keeps the rule's own time and carries no mark.
    const other = protectedRangesOn(retimed, NEXT);
    expect(other[0]).toMatchObject({ s: 9 * 60 + 30, e: 10 * 60 + 30 });
    expect(other[0]!.justToday).toBeUndefined();
  });

  it("a skipped block is not a range that day, and is still a range every other day", () => {
    expect(protectedRangesOn(skipped, TODAY)).toEqual([]);
    expect(protectedRangesOn(skipped, NEXT)).toHaveLength(1);
  });

  it("withSkipped returns the skipped block, flagged, for the one surface that shows it", () => {
    expect(protectedRangesOn(skipped, TODAY, { withSkipped: true })).toEqual([expect.objectContaining({ id: "bf", skipped: true })]);
  });

  it("an exception on a day the rule does not run is inert", () => {
    const r = routineWith({ ...BF, days: [1], exceptions: { [TODAY]: { startMin: 600, endMin: 660 } } });
    expect(protectedRangesOn(r, TODAY)).toEqual([]);
  });
});

describe("writers", () => {
  it("retimeBlockOn writes the exception and leaves the rule alone", () => {
    const after = retimeBlockOn(routineWith(BF), "bf", TODAY, 11 * 60, 12 * 60)!;
    const b = after.protectedBlocks![0]!;
    expect(b.startMin).toBe(BF.startMin);
    expect(b.endMin).toBe(BF.endMin);
    expect(b.exceptions).toEqual({ [TODAY]: { startMin: 660, endMin: 720 } });
  });

  it("skipBlockOn stores a skip; clearing it is Back to Normal and leaves a byte-identical block", () => {
    const skipped = skipBlockOn(routineWith(BF), "bf", TODAY, )!;
    expect(skipped.protectedBlocks![0]!.exceptions).toEqual({ [TODAY]: { skip: true } });
    const back = setBlockException(skipped, "bf", TODAY, null)!;
    expect(back.protectedBlocks![0]).toEqual(BF);
    expect("exceptions" in back.protectedBlocks![0]!).toBe(false);
  });

  it("an exception that says what the rule says is cleared, not stored", () => {
    const moved = retimeBlockOn(routineWith(BF), "bf", TODAY, 11 * 60, 12 * 60)!;
    const home = retimeBlockOn(moved, "bf", TODAY, BF.startMin, BF.endMin)!;
    expect(home.protectedBlocks![0]).toEqual(BF);
  });

  it("returns null for a block that is gone", () => {
    expect(retimeBlockOn(routineWith(BF), "nope", TODAY, 0, 60)).toBeNull();
  });

  it("Every Day edits (the rule writers) leave exceptions alone", () => {
    const withEx = retimeBlockOn(routineWith(BF), "bf", TODAY, 11 * 60, 12 * 60)!;
    const ex = { [TODAY]: { startMin: 660, endMin: 720 } };
    const edited = editBlockBasics(withEx, "bf", { label: "Brunch", startMin: 8 * 60, endMin: 9 * 60, days: [1, 2, 3, 4, 5, 6, 0] })!;
    expect(edited.protectedBlocks![0]).toMatchObject({ label: "Brunch", startMin: 480, endMin: 540, exceptions: ex });
    expect(shiftBlock(withEx, "bf", 15)!.protectedBlocks![0]!.exceptions).toEqual(ex);
    expect(retimeBlock(withEx, "bf", 480)!.protectedBlocks![0]!.exceptions).toEqual(ex);
    expect(resizeBlock(withEx, "bf", 600)!.protectedBlocks![0]!.exceptions).toEqual(ex);
  });

  it("prunes dates well in the past when anything is written, and an empty map entirely", () => {
    const stale: ProtectedBlock = { ...BF, exceptions: { "2026-01-01": { skip: true }, [TODAY]: { endMin: 660 } } };
    const pruned = pruneExceptions(stale, TODAY);
    expect(Object.keys(pruned.exceptions!)).toEqual([TODAY]);
    expect("exceptions" in pruneExceptions({ ...BF, exceptions: { "2026-01-01": { skip: true } } }, TODAY)).toBe(false);
    // And through the writer: writing one date drops the stale one.
    const after = skipBlockOn(routineWith(stale), "bf", NEXT)!;
    expect(Object.keys(after.protectedBlocks![0]!.exceptions!).sort()).toEqual([TODAY, NEXT]);
  });

  it("a past exception is harmless to the readers", () => {
    const r = routineWith({ ...BF, exceptions: { "2020-01-01": { skip: true } } });
    expect(protectedRangesOn(r, TODAY)).toHaveLength(1);
  });
});

describe("the row's own gestures on a day that carries an exception", () => {
  const moved = retimeBlockOn(routineWith(BF), "bf", TODAY, 11 * 60, 12 * 60)!;

  it("edit that exception, not the rule", () => {
    const shifted = shiftBlockForDate(moved, "bf", TODAY, 15)!.protectedBlocks![0]!;
    expect(shifted.exceptions![TODAY]).toEqual({ startMin: 675, endMin: 735 });
    expect(shifted.startMin).toBe(BF.startMin);
    const resized = resizeBlockForDate(moved, "bf", TODAY, 13 * 60)!.protectedBlocks![0]!;
    expect(resized.exceptions![TODAY]).toEqual({ startMin: 660, endMin: 780 });
    const retimed = retimeBlockForDate(moved, "bf", TODAY, 8 * 60)!.protectedBlocks![0]!;
    expect(retimed.exceptions![TODAY]).toEqual({ startMin: 480, endMin: 540 });
    expect(retimed.startMin).toBe(BF.startMin);
  });

  it("on a day with none, edit the rule exactly as before", () => {
    const shifted = shiftBlockForDate(moved, "bf", NEXT, 15)!.protectedBlocks![0]!;
    expect(shifted.startMin).toBe(BF.startMin + 15);
    expect(shifted.exceptions![TODAY]).toEqual({ startMin: 660, endMin: 720 });
  });
});

describe("readers honour the exception", () => {
  // Hard breakfast (not soft) so it is a wall in the capacity arithmetic.
  const HARD: ProtectedBlock = { ...BF, soft: false };
  const win = [7 * 60, 21 * 60] as const;
  const events: never[] = [];

  it("Plan My Day capacity: a skipped block frees its time", () => {
    const r = routineWith(HARD);
    const skipped = skipBlockOn(r, "bf", TODAY)!;
    const usual = openMinutes(events, protectedRangesOn(r, TODAY), ...win);
    const freed = openMinutes(events, protectedRangesOn(skipped, TODAY), ...win);
    expect(freed - usual).toBe(60);
    // Tomorrow is untouched.
    expect(openMinutes(events, protectedRangesOn(skipped, NEXT), ...win)).toBe(usual);
  });

  it("Plan My Day capacity: a moved block occupies its new time, not its old one", () => {
    const moved = retimeBlockOn(routineWith(HARD), "bf", TODAY, 7 * 60, 8 * 60)!;
    // Moved fully inside the window at the very start: same minutes taken, but
    // the old slot is free, so a 9:30 task now lands there.
    const hard = splitProtectedRanges(protectedRangesOn(moved, TODAY)).hard;
    const plan = planDay([{ id: "t", text: "t", category: "", durationMin: 60 }], [], 9 * 60 + 30, 12 * 60, 10, hard);
    expect(plan.blocks[0]).toMatchObject({ start: "09:30", end: "10:30" });
    const usualHard = splitProtectedRanges(protectedRangesOn(routineWith(HARD), TODAY)).hard;
    const usualPlan = planDay([{ id: "t", text: "t", category: "", durationMin: 60 }], [], 9 * 60 + 30, 12 * 60, 10, usualHard);
    expect(usualPlan.blocks[0]).toMatchObject({ start: "10:30", end: "11:30" });
  });

  it("the week row for the date counts the exception and no other date", () => {
    const skipped = skipBlockOn(routineWith(HARD), "bf", TODAY)!;
    const rows = weekRowsFor([TODAY, NEXT], [], skipped);
    expect(rows[0]!.blocks).toEqual([]);
    expect(rows[0]!.count).toBe(0);
    expect(rows[1]!.blocks.map((b) => [b.title, b.s, b.e])).toEqual([["Breakfast", 570, 630]]);
    expect(rows[0]!.openMin - rows[1]!.openMin).toBe(60);
    const moved = retimeBlockOn(routineWith(HARD), "bf", TODAY, 12 * 60, 13 * 60)!;
    expect(weekRowsFor([TODAY], [], moved)[0]!.blocks.map((b) => [b.s, b.e])).toEqual([[720, 780]]);
  });
});
