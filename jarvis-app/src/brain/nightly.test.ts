// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { consolidate, readConsolidation, DAILY_PROPOSAL_CAP } from "./nightly";
import type { Derived } from "./derive";

// THE NIGHTLY PASS (Brain build handoff item 2, decision x2 and x3).
// One consolidation per local day, up to three proposals, only when earned.

const m = (key: string): Derived => ({
  derivation: key as Derived["derivation"],
  category: "work_style",
  title: "t-" + key,
  sub: "s",
  strandText: "x",
  evidence: [],
});

beforeEach(() => localStorage.clear());

describe("the day's set is decided once", () => {
  it("takes up to three, and remembers which three", () => {
    const out = consolidate([m("a"), m("b"), m("c"), m("d")], "2026-09-04");
    expect(out.map((x) => x.derivation)).toEqual(["a", "b", "c"]);
    expect(readConsolidation()?.day).toBe("2026-09-04");
    expect(DAILY_PROPOSAL_CAP).toBe(3);
  });

  it("a quiet day stays quiet: three is a ceiling, never a quota", () => {
    expect(consolidate([], "2026-09-04")).toEqual([]);
    expect(consolidate([m("a")], "2026-09-05").map((x) => x.derivation)).toEqual(["a"]);
  });

  it("an empty read never locks the day shut", () => {
    // The window read is async and best-effort, so the FIRST render of a day
    // routinely arrives with zero moments (thin log, cold cache, offline).
    // Recording that as the day's answer would silence a real proposal that
    // crosses its gate an hour later, for no reason but bad timing.
    expect(consolidate([], "2026-09-04")).toEqual([]);
    expect(readConsolidation()).toBeNull();
    expect(consolidate([m("a")], "2026-09-04").map((x) => x.derivation)).toEqual(["a"]);
  });

  it("holds the set steady for the rest of the day", () => {
    // The nagging failure mode this exists to prevent: without a held set,
    // accepting one proposal in the morning promotes a fourth into view in
    // the afternoon, so the home screen produces a fresh thing to answer
    // every time it is opened.
    consolidate([m("a"), m("b"), m("c"), m("d")], "2026-09-04");
    const later = consolidate([m("a"), m("b"), m("c"), m("d")], "2026-09-04");
    expect(later.map((x) => x.derivation)).toEqual(["a", "b", "c"]);
    expect(later.map((x) => x.derivation)).not.toContain("d");
  });

  it("shrinks during the day as things get answered, and never grows", () => {
    consolidate([m("a"), m("b"), m("c"), m("d")], "2026-09-04");
    // "a" was accepted, so brainMoments no longer offers it.
    const after = consolidate([m("b"), m("c"), m("d")], "2026-09-04");
    expect(after.map((x) => x.derivation)).toEqual(["b", "c"]);
  });

  it("a new local day decides a new set", () => {
    consolidate([m("a"), m("b"), m("c")], "2026-09-04");
    const next = consolidate([m("d"), m("e")], "2026-09-05");
    expect(next.map((x) => x.derivation)).toEqual(["d", "e"]);
    expect(readConsolidation()?.day).toBe("2026-09-05");
  });
});
