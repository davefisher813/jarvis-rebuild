import { describe, it, expect } from "vitest";
import { parseSetPhrase } from "./parseSet";
import type { Exercise } from "./types";

// UP-ATH-18 (2026-09-06, option A): the bar is the one input on every screen,
// and while a session is live "225 for 5" belongs on the strip, not on a
// to-do list. Everything this parser is not certain about answers null and
// falls through to the normal capture routing.

const ex = (kind: Exercise["kind"], over: Partial<Exercise> = {}): Pick<Exercise, "kind" | "unit" | "timeUnit"> =>
  ({ kind, ...over });

const LIFT = ex("weight_reps", { unit: "lb" });

describe("parseSetPhrase on a weight exercise", () => {
  it("reads the shapes people actually type", () => {
    for (const text of ["225 for 5", "225x5", "225 x 5", "225 by 5"]) {
      expect(parseSetPhrase(text, LIFT), text).toEqual({ kind: "set", entry: { w: 225, r: 5 } });
    }
  });

  it("reads it the other way round too", () => {
    expect(parseSetPhrase("5 at 225", LIFT)).toEqual({ kind: "set", entry: { r: 5, w: 225 } });
    expect(parseSetPhrase("5 reps at 225", LIFT)).toEqual({ kind: "set", entry: { r: 5, w: 225 } });
  });

  it("takes the unit when it matches the exercise, and refuses when it does not", () => {
    expect(parseSetPhrase("5 at 100 kilos", ex("weight_reps", { unit: "kg" }))).toEqual({ kind: "set", entry: { r: 5, w: 100 } });
    // The lb exercise is NOT quietly converted: nobody typed 220.
    expect(parseSetPhrase("5 at 100 kilos", LIFT)).toBeNull();
  });

  it("reads a bare rep count, and refuses a bare number", () => {
    expect(parseSetPhrase("8 reps", LIFT)).toEqual({ kind: "set", entry: { r: 8 } });
    expect(parseSetPhrase("225", LIFT)).toBeNull();
  });

  it("refuses anything that is not a set, so a note stays a note", () => {
    for (const text of ["call the pharmacy", "225 for 5 sets of bench maybe", "buy 5 eggs", ""]) {
      expect(parseSetPhrase(text, LIFT), text).toBeNull();
    }
  });
});

describe("parseSetPhrase on the other kinds", () => {
  it("reps and rounds read a bare count, and an AMRAP keeps its remainder", () => {
    expect(parseSetPhrase("12", ex("reps"))).toEqual({ kind: "set", entry: { r: 12 } });
    expect(parseSetPhrase("12 reps", ex("reps"))).toEqual({ kind: "set", entry: { r: 12 } });
    expect(parseSetPhrase("7 rounds + 12", ex("rounds"))).toEqual({ kind: "set", entry: { r: 7, extra: 12 } });
  });

  it("a time reads seconds, minutes, or a clock", () => {
    expect(parseSetPhrase("45 seconds", ex("time_faster", { unit: "sec" }))).toEqual({ kind: "set", entry: { v: 45 } });
    expect(parseSetPhrase("1:30", ex("time_faster", { unit: "sec" }))).toEqual({ kind: "set", entry: { v: 90 } });
    expect(parseSetPhrase("1:30", ex("time_longer", { unit: "min" }))).toEqual({ kind: "set", entry: { v: 1.5 } });
  });

  it("a distance and a distance-plus-time keep their connector", () => {
    expect(parseSetPhrase("400 m", ex("distance", { unit: "m" }))).toEqual({ kind: "set", entry: { v: 400 } });
    expect(parseSetPhrase("400 m in 65 sec", ex("distance_time", { unit: "m", timeUnit: "sec" })))
      .toEqual({ kind: "set", entry: { v: 400, t: 65 } });
  });

  it("a height in inches is not read as the word in", () => {
    expect(parseSetPhrase("30 in", ex("height", { unit: "in" }))).toEqual({ kind: "set", entry: { v: 30 } });
    expect(parseSetPhrase("30 cm", ex("height", { unit: "in" }))).toBeNull();
  });
});

describe("parseSetPhrase reads the words that are actions", () => {
  it("same, skip, and done", () => {
    expect(parseSetPhrase("same", LIFT)).toEqual({ kind: "same" });
    expect(parseSetPhrase("again", LIFT)).toEqual({ kind: "same" });
    expect(parseSetPhrase("skip", LIFT)).toEqual({ kind: "skip" });
    expect(parseSetPhrase("done", ex("done"))).toEqual({ kind: "done" });
  });

  it("done on a lift is not a set of nothing: it falls through", () => {
    expect(parseSetPhrase("done", LIFT)).toBeNull();
  });
});
