import { describe, it, expect } from "vitest";
import { runSearch, totalHits, buildSuggestionIndex, suggest, type SearchInput } from "./search";

const data: SearchInput = {
  tasks: [{ id: "t1", data: { text: "Email Sam", done: false, category: "" } }],
  events: [{ id: "e1", data: { title: "Lunch with Sam", date: "2026-05-24", start: "13:00", category: "" } }],
  notes: [{ id: "n1", ownerId: "u", entityType: "note", serverTime: 0, data: { title: "Sam terms", blocks: [], connections: [], category: "" } as never }],
  people: [{ id: "p1", data: { name: "Sam Rivera", group: "inner_circle" } }],
  projects: [{ id: "pr1", data: { title: "Sam onboarding", status: "active" } }],
  accounts: [{ id: "a1", data: { name: "Sam savings", balance: 0, kind: "savings" } }],
  goals: [{ id: "g1", data: { title: "Call Sam weekly", state: "on_track" } }],
  categories: [{ id: "c1", data: { name: "Sam", color: "blue", icon: "tag", order: 0 } }],
};

describe("runSearch", () => {
  it("matches across all types, case-insensitive", () => {
    const r = runSearch("sam", data);
    expect(totalHits(r)).toBe(8);
    expect(r.people[0]!.name).toBe("Sam Rivera");
    expect(r.projects[0]!.title).toBe("Sam onboarding");
    expect(r.goals[0]!.title).toBe("Call Sam weekly");
    expect(r.accounts[0]!.name).toBe("Sam savings");
    expect(r.categories[0]!.name).toBe("Sam");
  });

  it("finds a note by text inside its blocks, not just the title", () => {
    const withBody: SearchInput = {
      ...data,
      notes: [{
        id: "n2", ownerId: "u", entityType: "note", serverTime: 0,
        data: {
          title: "Untitled thoughts",
          category: "",
          connections: [],
          blocks: [
            { id: "b1", type: "text", text: "call the venue about deposits" },
            { id: "b2", type: "checklist", items: [{ text: "book photographer", done: false }] },
          ],
        } as never,
      }],
    };
    expect(runSearch("deposits", withBody).notes.length).toBe(1);
    expect(runSearch("photographer", withBody).notes.length).toBe(1);
    expect(runSearch("nowhere", withBody).notes.length).toBe(0);
  });
  it("returns nothing for an empty query", () => {
    expect(totalHits(runSearch("   ", data))).toBe(0);
  });
  it("returns nothing when no match", () => {
    expect(totalHits(runSearch("zzz", data))).toBe(0);
  });
});

describe("type-ahead", () => {
  it("completes the word being typed from the user's content", () => {
    const idx = buildSuggestionIndex(data);
    expect(suggest("sa", idx)).toContain("sam");
    expect(suggest("lunch sa", idx)[0]).toBe("lunch sam");
    expect(suggest("s", idx)).toEqual([]); // needs 2+ chars
  });
});
