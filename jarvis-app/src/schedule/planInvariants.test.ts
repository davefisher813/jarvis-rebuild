import { describe, it, expect } from "vitest";
import { planDay, type PlanTask } from "./planDay";
import { openSlots } from "./calendar";
import { planWindowFor, protectedRangesFor, splitProtectedRanges, type RoutineData, type ProtectedBlock } from "../routine/types";
import type { EventItem } from "./types";

// Planning invariants (2026-08-10), born from "I don't want anymore issues
// with this." Instead of pinning one more screenshot, this file throws
// thousands of randomized routines, protected blocks, events, and task loads
// at the real pipeline and asserts the promises that make Plan My Day
// sensible for ANY routine a user can type in:
//
//   1. Every wake/sleep combination yields a usable planning window.
//   2. Placed blocks stay inside the window and never overlap events,
//      hard protected blocks, or each other.
//   3. "No room" is never a lie: a task is unplaced ONLY when no gap of its
//      size exists anywhere in the day.
//   4. A pick outside its work window or on a flexible block is labeled,
//      never silent.
//   5. Open rows on the schedule never overlap what the list shows as busy.
//
// Deterministic PRNG (mulberry32, fixed seed) so a failure reproduces
// exactly; Date.now()/Math.random() never appear here.

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const toMin = (hhmm: string) => { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Range = { s: number; e: number };
const overlaps = (a: Range, b: Range) => a.s < b.e && b.s < a.e;

// Brute-force: does any start position in [lo, hi - dur] avoid every busy
// range? Minute-by-minute, so it cannot miss what first-fit could reach.
function gapExists(busy: Range[], lo: number, hi: number, dur: number): boolean {
  for (let s = lo; s + dur <= hi; s++) {
    if (!busy.some((b) => s < b.e && b.s < s + dur)) return true;
  }
  return false;
}

describe("invariant 1: every routine yields a usable window", () => {
  it("window is at least an hour, ends within the day, for a full wake/sleep grid", () => {
    for (let wake = 0; wake < 24 * 60; wake += 13) {
      for (let sleep = 0; sleep < 24 * 60; sleep += 17) {
        const r: RoutineData = { wakeMin: wake, sleepMin: sleep, workStartMin: 540, workEndMin: 1020 };
        for (const dow of [0, 3, 6]) {
          const w = planWindowFor(r, dow);
          // A full hour of day, except when the claimed wake time itself sits
          // within an hour of midnight; then the window is what remains.
          expect(w.endMin - w.wakeMin, `wake=${wake} sleep=${sleep}`).toBeGreaterThanOrEqual(Math.min(60, 24 * 60 - 1 - wake));
          expect(w.endMin).toBeLessThan(24 * 60);
          expect(w.wakeMin).toBe(wake);
        }
      }
    }
  });
});

describe("invariants 2-4: randomized planner stress (500 days)", () => {
  const r = rng(20260810);

  for (let round = 0; round < 5; round++) {
    it(`round ${round + 1}: placements legal, No-room honest, labels present`, () => {
      for (let i = 0; i < 100; i++) {
        // A random life.
        const wake = int(r, 240, 720);
        const sleep = int(r, 0, 24 * 60 - 1); // any bedtime, incl. overnight
        const routine: RoutineData = {
          wakeMin: wake, sleepMin: sleep,
          workStartMin: int(r, 300, 780), workEndMin: int(r, 800, 1380),
          protectedBlocks: Array.from({ length: int(r, 0, 6) }, (_, k): ProtectedBlock => {
            const s = int(r, wake, 1380);
            const focusBlock = r() < 0.25; // some days have Deep Work zones
            return {
              id: "b" + k, label: focusBlock ? "Zone" + k : "Block" + k,
              startMin: s, endMin: Math.min(s + int(r, 15, 240), 24 * 60 - 1),
              days: [0, 1, 2, 3, 4, 5, 6],
              ...(focusBlock ? { kind: "focus" as const } : r() < 0.5 ? { soft: true } : {}),
            };
          }),
        };
        const dow = int(r, 0, 6);
        const win = planWindowFor(routine, dow);
        const { hard, soft, focus } = splitProtectedRanges(protectedRangesFor(routine, dow));

        // Random fixed events.
        const events = Array.from({ length: int(r, 0, 4) }, (_, k) => {
          const s = int(r, win.wakeMin, Math.max(win.wakeMin, win.endMin - 30));
          return { id: "e" + k, data: { start: hhmm(s), end: hhmm(Math.min(s + int(r, 15, 120), 24 * 60 - 1)) } };
        }) as unknown as EventItem[];
        const evRanges: Range[] = events.map((e) => ({ s: toMin(e.data.start), e: toMin(e.data.end!) }));

        // Random picks, some tied to a work window.
        const buffer = 10;
        const tasks: PlanTask[] = Array.from({ length: int(r, 1, 8) }, (_, k) => ({
          id: "t" + k, text: "t" + k, category: "", durationMin: int(r, 1, 12) * 15,
          ...(r() < 0.4 ? { windowS: routine.workStartMin, windowE: routine.workEndMin } : {}),
        }));

        const plan = planDay(tasks, events, win.wakeMin, win.endMin, buffer, hard, soft, focus);
        const ctx = `wake=${wake} sleep=${sleep} dow=${dow} i=${i}`;

        // Invariant 2: legal placements.
        const placed: Range[] = plan.blocks.map((b) => ({ s: toMin(b.start), e: toMin(b.end) }));
        for (let k = 0; k < plan.blocks.length; k++) {
          const b = plan.blocks[k]!, br = placed[k]!;
          expect(br.s, ctx).toBeGreaterThanOrEqual(win.wakeMin);
          expect(br.e, ctx).toBeLessThanOrEqual(win.endMin);
          for (const h of hard) expect(overlaps(br, h), `${ctx} block on hard`).toBe(false);
          for (const ev of evRanges) expect(overlaps(br, ev), `${ctx} block on event`).toBe(false);
          for (let j = 0; j < placed.length; j++) {
            if (j !== k) expect(overlaps(br, placed[j]!), `${ctx} blocks overlap`).toBe(false);
          }
          // Invariant 4: silence is forbidden. Outside its window or on a
          // flexible block means a label, so the UI can say so.
          const t = tasks.find((x) => x.id === b.taskId)!;
          if (t.windowS != null && !b.outsideWindow) {
            expect(br.s >= Math.max(win.wakeMin, t.windowS) && br.e <= Math.min(win.endMin, t.windowE ?? win.endMin), `${ctx} unlabeled window spill`).toBe(true);
          }
          if (!b.overSoft) {
            for (const sb of soft) expect(overlaps(br, sb), `${ctx} unlabeled soft overlap`).toBe(false);
          }
        }

        // Invariant 3: "No room" must be true. If any gap of the task's size
        // survives in the FINAL busy state (which only ever grew), first-fit
        // had it available and unplaced was a lie.
        const finalBusy: Range[] = [
          ...evRanges, ...hard,
          ...placed.map((p) => ({ s: p.s, e: p.e + buffer })),
        ];
        for (const u of plan.unplaced) {
          const dur = Math.max(5, u.durationMin);
          expect(gapExists(finalBusy, win.wakeMin, win.endMin, dur), `${ctx} said No room falsely for dur=${dur}`).toBe(false);
        }
      }
    });
  }
});

describe("invariant 5: open rows agree with the busy day (randomized)", () => {
  it("slots never overlap events or locked ranges, stay in window, in order", () => {
    const r = rng(41100);
    for (let i = 0; i < 200; i++) {
      const lo = int(r, 300, 660), hi = int(r, 900, 24 * 60 - 1);
      const events = Array.from({ length: int(r, 0, 4) }, (_, k) => {
        const s = int(r, 0, 24 * 60 - 90);
        return { id: "e" + k, data: { start: hhmm(s), end: hhmm(s + int(r, 15, 120)) } };
      }) as unknown as EventItem[];
      const locked = Array.from({ length: int(r, 0, 5) }, () => {
        const s = int(r, 0, 24 * 60 - 90);
        return { s, e: s + int(r, 15, 180) };
      });
      const busy: Range[] = [
        ...events.map((e) => ({ s: toMin(e.data.start), e: toMin(e.data.end!) })),
        ...locked,
      ];
      const slots = openSlots(events, hhmm(lo), hhmm(hi), 30, locked);
      let prevEnd = lo;
      for (const sl of slots) {
        const range = { s: toMin(sl.start), e: toMin(sl.end) };
        expect(range.s, `i=${i}`).toBeGreaterThanOrEqual(prevEnd);
        expect(range.e - range.s, `i=${i}`).toBeGreaterThanOrEqual(30);
        expect(range.s).toBeGreaterThanOrEqual(lo);
        expect(range.e).toBeLessThanOrEqual(hi);
        for (const b of busy) expect(overlaps(range, b), `i=${i} open row over busy`).toBe(false);
        prevEnd = range.e;
      }
    }
  });
});
