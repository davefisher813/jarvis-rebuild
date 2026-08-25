import { describe, it, expect } from "vitest";
import { brainMoments, correctionStats, derivationMuted, NOD_MIN_VOTES } from "./moments";
import type { WindowRow } from "./window";
import type { Strand } from "./strands/types";

const row = (over: Partial<WindowRow>): WindowRow => ({
  type: "task.completed", day: "2026-08-20", h: 10, category: null, n: null, flag: null, kind: null, ...over,
});

const completions = (n: number, h = 10): WindowRow[] =>
  Array.from({ length: n }, (_, i) => row({ h, day: `2026-08-${String((i % 20) + 1).padStart(2, "0")}` }));

const strand = (over: Partial<Strand["data"]> = {}): Strand => ({
  id: "s1",
  data: {
    text: "Gets things done between 10 AM and 1 PM in the morning",
    category: "energy", source: "watched", strength: "influence", status: "active",
    createdAt: "2026-08-01", lastConfirmed: "2026-08-01", derivation: "completion_window",
    ...over,
  },
});

describe("the nod test, operationalized", () => {
  it("counts creates, corrections and deletes per derivation", () => {
    const stats = correctionStats([
      row({ type: "strand.created", kind: "completion_window" }),
      row({ type: "strand.corrected", kind: "completion_window" }),
      row({ type: "strand.deleted", kind: "slip_category" }),
      row({ type: "strand.created", kind: "slip_category" }),
    ]);
    expect(stats.get("completion_window")).toEqual({ accepted: 1, corrected: 1, deleted: 0 });
    expect(stats.get("slip_category")).toEqual({ accepted: 1, corrected: 0, deleted: 1 });
  });

  it("does not mute on thin evidence, however bad it looks", () => {
    // Retune 2026-08-25: two corrective acts mute on their own; one does not.
    expect(derivationMuted({ accepted: 2, corrected: 2, deleted: 0 })).toBe(true);
    expect(derivationMuted({ accepted: 2, corrected: 1, deleted: 0 })).toBe(false);
  });

  it("mutes a derivation that keeps being wrong once there are real votes", () => {
    expect(derivationMuted({ accepted: NOD_MIN_VOTES, corrected: 3, deleted: 0 })).toBe(true);
  });

  it("leaves an accurate derivation alone", () => {
    expect(derivationMuted({ accepted: 10, corrected: 1, deleted: 0 })).toBe(false);
  });

  it("treats no history as no reason to be quiet", () => {
    expect(derivationMuted(undefined)).toBe(false);
  });
});

describe("brainMoments", () => {
  it("offers a supported derivation when nothing has answered it", () => {
    expect(brainMoments(completions(14), []).map((m) => m.derivation)).toEqual(["completion_window"]);
  });

  it("never re-offers a derivation that already became a strand", () => {
    expect(brainMoments(completions(14), [strand()])).toEqual([]);
  });

  it("re-offers nothing while a paused strand still holds the slot, because the user answered", () => {
    expect(brainMoments(completions(14), [strand({ status: "paused" })])).toEqual([]);
  });

  it("goes quiet on a derivation the user keeps correcting", () => {
    const rows = [
      ...completions(14),
      ...Array.from({ length: NOD_MIN_VOTES }, () => row({ type: "strand.created", kind: "completion_window" })),
      ...Array.from({ length: 3 }, () => row({ type: "strand.corrected", kind: "completion_window" })),
    ];
    expect(brainMoments(rows, [])).toEqual([]);
  });

  it("says nothing on an empty log, which is the common case", () => {
    expect(brainMoments([], [])).toEqual([]);
  });
});
