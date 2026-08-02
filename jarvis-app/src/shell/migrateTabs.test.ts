import { describe, it, expect } from "vitest";
import { migrateTabs, MAX_TABS, destOf } from "./destinations";

// A saved tab bar must never render a tab that resolves to nothing. These lock
// the Session 6 consolidation so a later change cannot quietly strand a user
// on a blank tab.
describe("migrateTabs", () => {
  it("maps the retired Life Map and Projects onto Bigger Picture", () => {
    expect(migrateTabs(["today", "goals"])).toEqual(["today", "bigger"]);
    expect(migrateTabs(["today", "projects"])).toEqual(["today", "bigger"]);
  });

  it("collapses both retired keys into one tab instead of duplicating", () => {
    expect(migrateTabs(["today", "goals", "projects", "tasks"])).toEqual(["today", "bigger", "tasks"]);
  });

  it("drops Insights, which has no replacement page", () => {
    expect(migrateTabs(["today", "insights", "tasks"])).toEqual(["today", "tasks"]);
  });

  it("drops keys that resolve to no destination at all", () => {
    expect(migrateTabs(["today", "nonsense", "tasks"])).toEqual(["today", "tasks"]);
  });

  it("preserves the user's order and leaves an untouched bar alone", () => {
    expect(migrateTabs(["schedule", "today", "brain"])).toEqual(["schedule", "today", "brain"]);
  });

  it("never exceeds the tab cap", () => {
    const out = migrateTabs(["today", "tasks", "schedule", "brain", "notes", "messages", "money"]);
    expect(out.length).toBe(MAX_TABS);
  });

  it("every surviving key resolves to a real destination", () => {
    for (const k of migrateTabs(["today", "goals", "projects", "insights", "notes", "bogus"])) {
      expect(destOf(k)).toBeTruthy();
    }
  });

  it("an empty or fully retired bar comes back empty rather than broken", () => {
    expect(migrateTabs([])).toEqual([]);
    expect(migrateTabs(["insights"])).toEqual([]);
  });
});
