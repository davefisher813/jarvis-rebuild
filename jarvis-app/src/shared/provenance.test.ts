import { describe, it, expect } from "vitest";
import { madeBy, sourceLine, rowSource, type Source } from "./provenance";

// Fixed clock: 2026-08-15 14:14 local.
const NOW = new Date(2026, 7, 15, 14, 14).getTime();
const now = () => NOW;

describe("provenance", () => {
  it("madeBy stamps type, ref, and the current time", () => {
    const s = madeBy("note", "n1", now);
    expect(s).toEqual({ type: "note", ref: "n1", ts: NOW });
  });

  it("madeBy omits ref when there is none", () => {
    const s = madeBy("sweep", undefined, now);
    expect(s).toEqual({ type: "sweep", ts: NOW });
    expect("ref" in s).toBe(false);
  });

  it("same-day sources show a clock time", () => {
    const s: Source = { type: "note", ref: "n1", ts: new Date(2026, 7, 15, 9, 5).getTime() };
    const line = sourceLine(s, now)!;
    expect(line.startsWith("From a note")).toBe(true);
    expect(line).toMatch(/9:05/);
  });

  it("older sources show a short date, not a time", () => {
    const s: Source = { type: "paste", ts: new Date(2026, 7, 12, 9, 5).getTime() };
    const line = sourceLine(s, now)!;
    expect(line.startsWith("From Smart Paste")).toBe(true);
    expect(line).toMatch(/Aug/);
    expect(line).not.toMatch(/9:05/);
  });

  it("no source renders nothing, so hand-made entities stay clean", () => {
    expect(sourceLine(undefined, now)).toBeNull();
  });

  it("an unknown stored type renders nothing rather than guessing", () => {
    expect(sourceLine({ type: "mystery" as Source["type"], ts: NOW }, now)).toBeNull();
  });

  // UP-CORE-05 (2026-09-05): a thing can carry both where it came from and
  // an automated move. Auto-Sweep moves are kept internal and never displayed.
  it("Auto-Sweep moves stay internal, never shown on rows", () => {
    const from: Source = { type: "paste", ts: new Date(2026, 7, 10, 9, 0).getTime() };
    const movedToday: Source = { type: "sweep", ts: new Date(2026, 7, 15, 6, 0).getTime() };
    const movedBefore: Source = { type: "sweep", ts: new Date(2026, 7, 14, 6, 0).getTime() };
    // rowSource skips sweep moves (keeps origin instead) so rows never show sweep provenance
    expect(rowSource(from, movedToday, now)).toBe(from);
    expect(rowSource(from, movedBefore, now)).toBe(from);
    expect(rowSource(from, undefined, now)).toBe(from);
    expect(rowSource(undefined, movedToday, now)).toBeUndefined();
    expect(rowSource(undefined, undefined, now)).toBeUndefined();
  });
});
