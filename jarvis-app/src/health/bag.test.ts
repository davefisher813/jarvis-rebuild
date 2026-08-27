import { describe, it, expect } from "vitest";
import { BAG_ITEMS, defaultBagItems, latestBagCheck, toggleItem, checkAll, allChecked } from "./bag";
import type { BagCheckEntry } from "./types";

describe("defaultBagItems", () => {
  it("starts every item unchecked, and Water With You is a row, not a feature", () => {
    const items = defaultBagItems();
    expect(items.every((i) => !i.checked)).toBe(true);
    expect(items.map((i) => i.key)).toEqual(BAG_ITEMS.map((d) => d.key));
    expect(items.map((i) => i.key)).toContain("water");
  });
});

describe("latestBagCheck", () => {
  it("returns the most recently logged state for the event", () => {
    const older: BagCheckEntry = { id: "1", data: { category: "logistics", eventId: "e1", date: "2026-08-27", items: defaultBagItems(), at: 1000 } };
    const newer: BagCheckEntry = { id: "2", data: { category: "logistics", eventId: "e1", date: "2026-08-27", items: checkAll(defaultBagItems()), at: 2000 } };
    expect(latestBagCheck([older, newer], "e1")!.id).toBe("2");
  });

  it("is null when the event has no logged checklist", () => {
    expect(latestBagCheck([], "e1")).toBeNull();
  });

  it("never mixes another event's entries in", () => {
    const other: BagCheckEntry = { id: "1", data: { category: "logistics", eventId: "e2", date: "2026-08-27", items: defaultBagItems(), at: 1000 } };
    expect(latestBagCheck([other], "e1")).toBeNull();
  });
});

describe("toggleItem / checkAll / allChecked", () => {
  it("flips exactly one item", () => {
    const items = toggleItem(defaultBagItems(), "water");
    expect(items.find((i) => i.key === "water")!.checked).toBe(true);
    expect(items.filter((i) => i.checked)).toHaveLength(1);
  });

  it("checks everything with one call, and object-level only (no ounces field anywhere)", () => {
    const items = checkAll(defaultBagItems());
    expect(allChecked(items)).toBe(true);
    for (const i of items) expect(Object.keys(i).sort()).toEqual(["checked", "key"]);
  });
});
