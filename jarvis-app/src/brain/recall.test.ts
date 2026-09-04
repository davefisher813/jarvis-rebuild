import { describe, it, expect } from "vitest";
import { rankForRecall, fadedStrands, strengthOf, daysSince, FADE_AFTER_DAYS } from "./recall";
import type { Strand, StrandData, StrandSource } from "./strands/types";

// STRENGTHEN AND FADE (handoff item 9, spec 5.8, decision m1). The field
// lastConfirmed has been written by four paths since August and read by one
// display string. types.ts said an expiry policy was Dave's call; he made it
// on 2026-08-31, so the field gets its reader.

const TODAY = "2026-09-04";

const s = (id: string, over: Partial<StrandData> = {}): Strand => ({
  id,
  data: {
    text: "t-" + id,
    category: "work_style",
    source: "watched" as StrandSource,
    strength: "influence",
    status: "active",
    createdAt: "2026-01-01",
    lastConfirmed: TODAY,
    ...over,
  },
});

const ago = (days: number): string =>
  new Date(Date.parse(TODAY + "T00:00:00") - days * 86400000).toISOString().slice(0, 10);

describe("daysSince", () => {
  it("counts whole local days and never goes negative", () => {
    expect(daysSince(TODAY, TODAY)).toBe(0);
    expect(daysSince(ago(30), TODAY)).toBe(30);
    expect(daysSince("2026-12-01", TODAY)).toBe(0); // a future date is not negative age
    expect(daysSince("nonsense", TODAY)).toBe(0);
  });
});

describe("strengthen: what JARVIS leans on first", () => {
  it("a fact confirmed today outranks the same fact left alone for a season", () => {
    expect(strengthOf(s("fresh"), TODAY)).toBeGreaterThan(strengthOf(s("old", { lastConfirmed: ago(120) }), TODAY));
  });

  it("age reorders WITHIN a rank and never overturns the doctrine", () => {
    // told is earned and outranks watched (Aug 3 law). An ancient told fact
    // still beats a fresh asked one, or the source ranking would be decided
    // by whoever confirmed something most recently.
    const oldTold = s("a", { source: "told", lastConfirmed: ago(365) });
    const freshAsked = s("b", { source: "asked", lastConfirmed: TODAY });
    expect(strengthOf(oldTold, TODAY)).toBeGreaterThan(strengthOf(freshAsked, TODAY));
  });

  it("orders for recall, strongest first, ties keeping newest-first", () => {
    const out = rankForRecall([
      s("stale", { lastConfirmed: ago(200) }),
      s("told", { source: "told", lastConfirmed: ago(200) }),
      s("fresh"),
    ], TODAY).map((x) => x.id);
    expect(out[0]).toBe("told");
    expect(out[1]).toBe("fresh");
    expect(out[2]).toBe("stale");
  });

  it("orders, never drops: a quiet fact is still a fact", () => {
    const all = [s("a", { lastConfirmed: ago(900) }), s("b"), s("c", { source: "asked" })];
    expect(rankForRecall(all, TODAY)).toHaveLength(3);
  });

  it("does not mutate the list it was given", () => {
    const all = [s("a", { lastConfirmed: ago(200) }), s("b")];
    rankForRecall(all, TODAY);
    expect(all.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("fade: a question, never a deletion", () => {
  it("says nothing until a fact has been quiet for a whole season", () => {
    expect(fadedStrands([s("a", { lastConfirmed: ago(FADE_AFTER_DAYS - 1) })], TODAY)).toHaveLength(0);
    expect(fadedStrands([s("a", { lastConfirmed: ago(FADE_AFTER_DAYS) })], TODAY)).toHaveLength(1);
  });

  it("asks about the longest-quiet one first", () => {
    const out = fadedStrands([
      s("recent", { lastConfirmed: ago(100) }),
      s("ancient", { lastConfirmed: ago(400) }),
    ], TODAY);
    expect(out[0]!.id).toBe("ancient");
  });

  it("never asks about a paused fact", () => {
    // The user already told JARVIS to stop using that one. Asking whether it
    // still holds is a nag about a decision they already made.
    expect(fadedStrands([s("a", { status: "paused", lastConfirmed: ago(400) })], TODAY)).toHaveLength(0);
  });

  it("asks about a told fact too, not only a watched one", () => {
    // A stated fact can go stale as easily as an observed one: "family
    // dinner is non-negotiable" survives a house move or it does not.
    expect(fadedStrands([s("a", { source: "told", lastConfirmed: ago(400) })], TODAY)).toHaveLength(1);
  });
});
