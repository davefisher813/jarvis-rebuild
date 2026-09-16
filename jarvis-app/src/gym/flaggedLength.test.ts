import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { durationOf, SUSPECT_ACTIVE_MIN } from "../insights/analytics";
import type { WorkoutData } from "./types";

// A SESSION'S LENGTH IS NOT ALWAYS A FACT (2026-09-16, Dave's Program
// screenshot: a recent session reading 382 MIN, stated as flatly as the date
// beside it).
//
// The end is stamped when Finish is tapped, so one left open -- the app closed
// with it live, the phone in a locker, a finish the next morning -- records
// the whole wall clock as time trained. durationOf has owned the threshold
// since 2026-09-14 and DurationCard has shown and corrected it. What was
// missing is that the BROWSING rows never asked, so the one number that
// needed the sheet was the one thing on the row with no way to know it did.
//
// Nothing here caps or rewrites a recorded time.

const src = (f: string) => readFileSync(join(__dirname, f), "utf8");

const w = (mins: number, stamps: number[] = []): WorkoutData => ({
  programId: "p", dayId: "d", dayName: "Leg Day", date: "2026-09-16",
  startedAt: 0, endedAt: mins * 60_000,
  exercises: [{ exerciseId: "e", name: "Squat", kind: "weight_reps", sets: stamps.map((at, i) => ({ id: "s" + i, w: 185, r: 5, at })) }],
});

describe("a length worth reviewing says so where it is read", () => {
  it("382 minutes is past the threshold, and 60 is not", () => {
    expect(durationOf(w(382)).flagged).toBe(true);
    expect(durationOf(w(60)).flagged).toBe(false);
    expect(SUSPECT_ACTIVE_MIN).toBe(240);
  });

  it("the number itself is never touched", () => {
    expect(durationOf(w(382)).activeMin).toBe(382);
  });

  it("the gym's two browsing rows read the flag rather than stating the minutes flat", () => {
    const flow = src("GymFlow.tsx");
    // One helper, so the Recent row and the workout's own head cannot
    // disagree about when a length is worth a look.
    expect(flow).toMatch(/function minutesChip\(w: WorkoutData\)/);
    expect(flow).toMatch(/d\.flagged[\s\S]{0,200}se-chip-over/);
    expect(flow.match(/\{minutesChip\(w\.data\)\}/g)?.length, "the Recent row and the workout head").toBe(2);
    // And no row states the minutes without going through it.
    expect(flow).not.toMatch(/se-chip-budget">\{mins\}/);
  });

  it("and so does the Health log's own row", () => {
    expect(readFileSync(join(__dirname, "..", "health", "log.ts"), "utf8"))
      .toMatch(/d\.flagged \? " · Worth Reviewing" : ""/);
  });
});
