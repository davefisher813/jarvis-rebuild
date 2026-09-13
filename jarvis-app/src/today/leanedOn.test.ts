import { describe, it, expect } from "vitest";
import { rememberLeanedOn, leanedOnFor } from "./leanedOn";
import type { Storage2 } from "../gym/liveSession";

function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

// C-25's leaningOn seam, fed at last (2026-09-13).
describe("the strand the plan leaned on", () => {
  it("is read back for a pick on the day it was committed, and for nothing else", () => {
    const s = mem();
    rememberLeanedOn("2026-09-13", "Gets things done mid morning", s);
    expect(leanedOnFor("2026-09-13", "t1", ["t1", "t2"], s)).toEqual({ text: "Gets things done mid morning" });
    expect(leanedOnFor("2026-09-13", "t9", ["t1", "t2"], s)).toBeNull();
    expect(leanedOnFor("2026-09-14", "t1", ["t1"], s)).toBeNull();
  });

  it("a commit with nothing leaned on clears the last one, and corrupt storage reads as nothing", () => {
    const s = mem();
    rememberLeanedOn("2026-09-13", "Family dinner is non-negotiable", s);
    rememberLeanedOn("2026-09-13", null, s);
    expect(leanedOnFor("2026-09-13", "t1", ["t1"], s)).toBeNull();
    s.write("jarvis.plan.leanedOn.v1", "{nope");
    expect(leanedOnFor("2026-09-13", "t1", ["t1"], s)).toBeNull();
  });
});
