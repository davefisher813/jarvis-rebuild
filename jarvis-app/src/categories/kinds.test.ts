import { describe, it, expect } from "vitest";
import { suggestKind, effectiveKind, pausedCategoryIds, offHoursCategoryIds } from "./kinds";
import type { Category, CategoryData } from "./types";

// The kind derivation: conservative by design (a wrong module block is worse
// than the skeleton), never auto-written, and the explicit kind always wins.

const cat = (data: Partial<CategoryData>): Category =>
  ({ id: "c", data: { name: "X", color: "blue", order: 0, ...data } }) as Category;

describe("suggestKind", () => {
  it("maps the template default names", () => {
    expect(suggestKind("Work")).toBe("org");
    expect(suggestKind("Clients")).toBe("org");
    expect(suggestKind("School")).toBe("org");
    expect(suggestKind("Family")).toBe("people");
    expect(suggestKind("Friends")).toBe("people");
    expect(suggestKind("Money")).toBe("money");
    expect(suggestKind("Finance")).toBe("money");
    expect(suggestKind("Health")).toBe("health");
  });
  it("unknown names are plain, never a guess", () => {
    expect(suggestKind("Personal")).toBe("plain");
    expect(suggestKind("Bridge")).toBe("plain");
    expect(suggestKind("")).toBe("plain");
  });
});

describe("effectiveKind", () => {
  it("explicit kind wins over the name suggestion", () => {
    expect(effectiveKind(cat({ name: "Bridge", kind: "org" }).data)).toBe("org");
    expect(effectiveKind(cat({ name: "Work", kind: "plain" }).data)).toBe("plain");
    expect(effectiveKind(cat({ name: "Work" }).data)).toBe("org");
  });
});

describe("pausedCategoryIds", () => {
  it("collects only paused categories", () => {
    const ids = pausedCategoryIds([
      { id: "a", data: { name: "Work", color: "blue", order: 0, kind: "org", season: "paused" } },
      { id: "b", data: { name: "Family", color: "pink", order: 1 } },
    ] as Category[]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(false);
  });
});

// Work-hours quiet set (audit 2026-08-10): after hours, work-category tasks
// stop being OFFERED. Same shape as the season pause so callers can union.

describe("offHoursCategoryIds", () => {
  const CATS = [
    { id: "w", data: { name: "Work", color: "blue", order: 0, kind: "org", workHours: true } },
    { id: "h", data: { name: "Home", color: "green", order: 1 } },
  ] as Category[];
  const ROUTINE = { workStartMin: 540, workEndMin: 1020 }; // 9-5

  it("after hours, work-hours categories are quiet; others never are", () => {
    const ids = offHoursCategoryIds(CATS, ROUTINE, 21 * 60);
    expect(ids.has("w")).toBe(true);
    expect(ids.has("h")).toBe(false);
  });

  it("inside work hours nothing is quiet, boundaries included", () => {
    expect(offHoursCategoryIds(CATS, ROUTINE, 540).size).toBe(0); // 9:00 sharp
    expect(offHoursCategoryIds(CATS, ROUTINE, 720).size).toBe(0);
    expect(offHoursCategoryIds(CATS, ROUTINE, 1020).has("w")).toBe(true); // 5:00 sharp is off
  });

  it("no routine or an inverted window means no gating at all", () => {
    expect(offHoursCategoryIds(CATS, null, 21 * 60).size).toBe(0);
    expect(offHoursCategoryIds(CATS, { workStartMin: 600, workEndMin: 600 }, 21 * 60).size).toBe(0);
  });
});
