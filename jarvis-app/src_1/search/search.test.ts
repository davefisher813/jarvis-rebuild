import { describe, it, expect } from "vitest";
import { runSearch, totalHits, type SearchInput } from "./search";

const data: SearchInput = {
  tasks: [{ id: "t1", data: { text: "Email Sam", done: false, category: "" } }],
  events: [{ id: "e1", data: { title: "Lunch with Sam", date: "2026-05-24", start: "13:00", category: "" } }],
  notes: [{ id: "n1", ownerId: "u", entityType: "note", serverTime: 0, data: { title: "Sam terms", blocks: [], connections: [], category: "" } as never }],
  people: [{ id: "p1", data: { name: "Sam Rivera", group: "inner_circle" } }],
};

describe("runSearch", () => {
  it("matches across all types, case-insensitive", () => {
    const r = runSearch("sam", data);
    expect(totalHits(r)).toBe(4);
    expect(r.people[0]!.name).toBe("Sam Rivera");
  });
  it("returns nothing for an empty query", () => {
    expect(totalHits(runSearch("   ", data))).toBe(0);
  });
  it("returns nothing when no match", () => {
    expect(totalHits(runSearch("zzz", data))).toBe(0);
  });
});
