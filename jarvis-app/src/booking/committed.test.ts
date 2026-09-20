import { describe, it, expect } from "vitest";
import { blockFor, mergeBlocks, committedBlocks, ASSUMED_MIN } from "./committed";

// HOURS HE HAS ALREADY SPOKEN FOR (Track 3, 2026-09-19).
//
// A booking link that double-books its owner is worse than no booking link, so
// the interesting cases here are all the ways an event fails to say clearly how
// long it lasts. Every one of them has to come out as "this hour is taken"
// rather than as nothing.

describe("blockFor", () => {
  it("is the event's own window when it says both ends", () => {
    expect(blockFor({ date: "2026-09-22", start: "14:00", end: "15:30" }))
      .toEqual({ date: "2026-09-22", startTime: "14:00", endTime: "15:30" });
  });

  // An event with a start and no end is an ordinary thing in this app. Treating
  // it as instantaneous offers a stranger the hour he is already sitting in.
  it("assumes an hour when the event never said when it ends", () => {
    expect(blockFor({ date: "2026-09-22", start: "09:00" }))
      .toEqual({ date: "2026-09-22", startTime: "09:00", endTime: "10:00" });
    expect(ASSUMED_MIN).toBe(60);
  });
  it("assumes an hour when the end is before the start, rather than reading it as overnight", () => {
    // This app stores one date per event, so a backwards end is a bad row and
    // not a 23 hour meeting that would block a whole day.
    expect(blockFor({ date: "2026-09-22", start: "22:00", end: "02:00" })?.endTime).toBe("23:00");
  });

  // Leave By is time he is in a car. A booking taken then is a meeting he is
  // driving through.
  it("counts travel before and buffer after, because both are time he is not free", () => {
    expect(blockFor({ date: "2026-09-22", start: "14:00", end: "15:00", travelMin: 30, bufferMin: 15 }))
      .toEqual({ date: "2026-09-22", startTime: "13:30", endTime: "15:15" });
  });
  it("ignores a negative travel or buffer rather than inverting the window", () => {
    expect(blockFor({ date: "2026-09-22", start: "14:00", end: "15:00", travelMin: -60, bufferMin: -60 }))
      .toEqual({ date: "2026-09-22", startTime: "14:00", endTime: "15:00" });
  });
  it("clamps to the day it is on, since the row it becomes carries one date", () => {
    expect(blockFor({ date: "2026-09-22", start: "00:15", end: "23:30", travelMin: 60, bufferMin: 120 }))
      .toEqual({ date: "2026-09-22", startTime: "00:00", endTime: "24:00" });
  });

  it("is null for anything that is not an event on a day at a time", () => {
    expect(blockFor({ date: "", start: "09:00" })).toBeNull();
    expect(blockFor({ date: "22/09/2026", start: "09:00" })).toBeNull();
    expect(blockFor({ date: "2026-09-22", start: "" })).toBeNull();
    expect(blockFor({ date: "2026-09-22", start: "9am" })).toBeNull();
    expect(blockFor({ date: "2026-09-22", start: "25:00" })).toBeNull();
  });
});

describe("mergeBlocks", () => {
  const D = "2026-09-22";

  it("joins two windows that overlap", () => {
    expect(mergeBlocks([
      { date: D, startTime: "09:00", endTime: "10:30" },
      { date: D, startTime: "10:00", endTime: "11:00" },
    ])).toEqual([{ date: D, startTime: "09:00", endTime: "11:00" }]);
  });
  it("joins two windows that merely touch, because there is no gap to book into", () => {
    expect(mergeBlocks([
      { date: D, startTime: "09:00", endTime: "10:00" },
      { date: D, startTime: "10:00", endTime: "11:00" },
    ])).toEqual([{ date: D, startTime: "09:00", endTime: "11:00" }]);
  });
  it("keeps a real gap between them, because that gap is bookable", () => {
    expect(mergeBlocks([
      { date: D, startTime: "09:00", endTime: "10:00" },
      { date: D, startTime: "11:00", endTime: "12:00" },
    ])).toHaveLength(2);
  });
  it("swallows a window entirely inside another", () => {
    expect(mergeBlocks([
      { date: D, startTime: "09:00", endTime: "17:00" },
      { date: D, startTime: "12:00", endTime: "13:00" },
    ])).toEqual([{ date: D, startTime: "09:00", endTime: "17:00" }]);
  });
  it("never merges across two different days", () => {
    const out = mergeBlocks([
      { date: "2026-09-22", startTime: "23:00", endTime: "24:00" },
      { date: "2026-09-23", startTime: "00:00", endTime: "01:00" },
    ]);
    expect(out).toHaveLength(2);
  });
  it("comes back in order, whatever order it went in", () => {
    const out = mergeBlocks([
      { date: "2026-09-23", startTime: "09:00", endTime: "10:00" },
      { date: "2026-09-22", startTime: "15:00", endTime: "16:00" },
      { date: "2026-09-22", startTime: "09:00", endTime: "10:00" },
    ]);
    expect(out.map((b) => b.date + " " + b.startTime))
      .toEqual(["2026-09-22 09:00", "2026-09-22 15:00", "2026-09-23 09:00"]);
  });
  it("is empty for nothing", () => {
    expect(mergeBlocks([])).toEqual([]);
  });
});

describe("committedBlocks", () => {
  // A weekly meeting occurs on many days, and the row it becomes names the day
  // it is on rather than the day the series was anchored to.
  it("uses the occurrence's day, not the event's anchor", () => {
    const out = committedBlocks([
      { date: "2026-09-29", data: { start: "14:00", end: "15:00" } },
    ], "2026-09-22", "2026-10-22");
    expect(out).toEqual([{ date: "2026-09-29", startTime: "14:00", endTime: "15:00" }]);
  });
  it("drops anything outside the window the link offers", () => {
    const out = committedBlocks([
      { date: "2026-09-21", data: { start: "09:00", end: "10:00" } },
      { date: "2026-09-22", data: { start: "09:00", end: "10:00" } },
      { date: "2026-10-23", data: { start: "09:00", end: "10:00" } },
    ], "2026-09-22", "2026-10-22");
    expect(out).toEqual([{ date: "2026-09-22", startTime: "09:00", endTime: "10:00" }]);
  });
  it("merges as it goes, so a stacked morning is one window", () => {
    const out = committedBlocks([
      { date: "2026-09-22", data: { start: "09:00", end: "10:00" } },
      { date: "2026-09-22", data: { start: "09:30", end: "11:00" } },
    ], "2026-09-22", "2026-10-22");
    expect(out).toEqual([{ date: "2026-09-22", startTime: "09:00", endTime: "11:00" }]);
  });
  it("skips an occurrence that cannot say when it is", () => {
    const out = committedBlocks([
      { date: "2026-09-22", data: { start: "" } },
      { date: "2026-09-22", data: { start: "09:00", end: "10:00" } },
    ], "2026-09-22", "2026-10-22");
    expect(out).toHaveLength(1);
  });
});
