import { describe, it, expect } from "vitest";
import { suggestKind, effectiveKind, pausedCategoryIds } from "./kinds";
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
