import { describe, it, expect } from "vitest";
import { madeBy, sourceLine, type Source } from "./provenance";

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
});
