import { describe, it, expect } from "vitest";
import { doseRows, lastDose, repeatWithin, doseToast, whenShort, DOSE_REPEAT_MS } from "./meds";
import { BODY_REGIONS, regionByLabel } from "./regions";
import type { MedDefEntry, TookItEntry } from "./types";

// Health Push D, H-38 and H-46 (2026-09-12).
const DEFS: MedDefEntry[] = [
  { id: "m1", data: { category: "medication", name: "Vitamin D", amount: "2000 IU", order: 0, at: 1 } },
  { id: "m2", data: { category: "medication", name: "Iron", order: 1, at: 2 } },
];
const dose = (id: string, at: number, medId?: string, amount?: string, pending?: boolean): TookItEntry & { pending?: boolean } =>
  ({ id, data: { category: "medication", at, ...(medId ? { medId } : {}), ...(amount ? { amount } : {}) }, ...(pending ? { pending } : {}) });

describe("doseRows", () => {
  it("names each dose from its med, falls back to the med's amount, and flags pending rows", () => {
    const rows = doseRows([dose("d2", 200, "m1"), dose("d1", 100, "m2", "65 mg", true), dose("d0", 50)], DEFS);
    expect(rows.map((r) => [r.name, r.amount ?? null, r.pending ?? false])).toEqual([
      ["Dose", null, false],
      ["Iron", "65 mg", true],
      ["Vitamin D", "2000 IU", false],
    ]);
  });

  it("a dose whose med was removed still reads as a dose", () => {
    expect(doseRows([dose("d1", 100, "gone")], DEFS)[0]!.name).toBe("Dose");
  });
});

describe("the ten-minute guard", () => {
  const rows = [{ at: 1_000_000, medId: "m1" }, { at: 1_000_000 + 5 * 60_000, medId: "m2" }];

  it("finds the same med's dose inside the window and nothing outside it", () => {
    expect(repeatWithin(rows, "m1", 1_000_000 + 9 * 60_000)?.at).toBe(1_000_000);
    expect(repeatWithin(rows, "m1", 1_000_000 + DOSE_REPEAT_MS)).toBeNull();
    expect(repeatWithin(rows, "m2", 1_000_000 + 6 * 60_000)?.medId).toBe("m2");
  });

  it("with no med named, any dose inside the window counts", () => {
    expect(repeatWithin(rows, undefined, 1_000_000 + 6 * 60_000)?.medId).toBe("m2");
    expect(repeatWithin([], undefined, 5)).toBeNull();
  });

  it("lastDose is the newest, per med or overall", () => {
    expect(lastDose(rows)?.medId).toBe("m2");
    expect(lastDose(rows, "m1")?.at).toBe(1_000_000);
    expect(lastDose(rows, "m9")).toBeNull();
  });
});

describe("copy", () => {
  it("the receipt carries the amount when there is one", () => {
    expect(doseToast("10 mg")).toBe("Dose logged · 10 mg");
    expect(doseToast()).toBe("Dose logged");
  });

  it("whenShort is a clock today and a date otherwise", () => {
    const now = new Date("2026-09-13T15:00:00").getTime();
    expect(whenShort(new Date("2026-09-13T08:05:00").getTime(), now)).toMatch(/8:05/);
    expect(whenShort(new Date("2026-09-11T08:05:00").getTime(), now)).not.toMatch(/8:05/);
  });
});

describe("the twelve regions", () => {
  it("are twelve, each with a coordinate on the map, and far enough apart to cluster separately", () => {
    expect(BODY_REGIONS).toHaveLength(12);
    for (let i = 0; i < BODY_REGIONS.length; i++) {
      for (let j = i + 1; j < BODY_REGIONS.length; j++) {
        const a = BODY_REGIONS[i]!;
        const b = BODY_REGIONS[j]!;
        if (a.side !== b.side) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y), a.label + " vs " + b.label).toBeGreaterThan(0.06);
      }
    }
    expect(regionByLabel("Left Knee")?.side).toBe("front");
    expect(regionByLabel("Lower Back")?.side).toBe("back");
    expect(regionByLabel("Elbow")).toBeNull();
  });
});
