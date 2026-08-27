import { describe, it, expect } from "vitest";
import { eatingGaps, eatingWindowOffers, MIN_MEAL_MINUTES } from "./eatingWindows";

const D = "2026-08-28T";
const t = (hm: string) => Date.parse(D + hm + ":00");

describe("eatingGaps", () => {
  it("finds a gap too short for a meal between two blocks", () => {
    const blocks = [
      { title: "School", start: t("08:00"), end: t("14:50") },
      { title: "Practice", start: t("15:05"), end: t("17:00") },
    ];
    const gaps = eatingGaps(blocks);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.minutes).toBe(15);
    expect(gaps[0]!.minutes).toBeLessThan(MIN_MEAL_MINUTES);
  });

  it("finds no gap when there is real room for a meal", () => {
    const blocks = [
      { title: "School", start: t("08:00"), end: t("14:50") },
      { title: "Practice", start: t("16:30"), end: t("18:00") },
    ];
    expect(eatingGaps(blocks)).toHaveLength(0);
  });

  it("contains no nutrition content: no amount, no quality field", () => {
    const blocks = [{ title: "School", start: t("08:00"), end: t("14:50") }, { title: "Practice", start: t("15:00"), end: t("17:00") }];
    for (const g of eatingGaps(blocks)) {
      expect(Object.keys(g).sort()).toEqual(["afterTitle", "beforeTitle", "end", "minutes", "start"]);
    }
  });
});

describe("eatingWindowOffers", () => {
  it("offers a schedule action, never advice about food", () => {
    const blocks = [{ title: "School", start: t("08:00"), end: t("14:50") }, { title: "Practice", start: t("15:00"), end: t("17:00") }];
    const offers = eatingWindowOffers(blocks);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.line).toMatch(/School/);
    expect(offers[0]!.line).toMatch(/Practice/);
    expect(offers[0]!.line).not.toMatch(/calorie|protein|carb/i);
  });
});
