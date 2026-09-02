import { describe, it, expect } from "vitest";
import { migrateTabs, MAX_TABS, destOf } from "./destinations";

// A saved tab bar must never render a tab that resolves to nothing. These lock
// the Session 6 consolidation so a later change cannot quietly strand a user
// on a blank tab.
describe("migrateTabs", () => {
  // 2026-09-01: Bigger Picture and Tasks became Life. Every retired key
  // that pointed at either now lands on the one tab.
  it("maps the retired Life Map and Projects onto Life", () => {
    expect(migrateTabs(["today", "goals"])).toEqual(["today", "life"]);
    expect(migrateTabs(["today", "projects"])).toEqual(["today", "life"]);
  });

  it("collapses Tasks and Your Life into one Life tab, in the earlier slot", () => {
    expect(migrateTabs(["today", "tasks", "schedule", "bigger"])).toEqual(["today", "life", "schedule"]);
    expect(migrateTabs(["today", "bigger", "schedule", "tasks"])).toEqual(["today", "life", "schedule"]);
    expect(migrateTabs(["today", "goals", "projects", "tasks"])).toEqual(["today", "life"]);
  });

  it("drops Insights, which has no replacement page", () => {
    expect(migrateTabs(["today", "insights", "life"])).toEqual(["today", "life"]);
  });

  it("drops keys that resolve to no destination at all", () => {
    expect(migrateTabs(["today", "nonsense", "life"])).toEqual(["today", "life"]);
  });

  it("preserves the user's order and leaves an untouched bar alone", () => {
    expect(migrateTabs(["schedule", "today", "brain"])).toEqual(["schedule", "today", "brain"]);
  });

  it("never exceeds the tab cap", () => {
    const out = migrateTabs(["today", "life", "schedule", "brain", "notes", "messages", "money"]);
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
