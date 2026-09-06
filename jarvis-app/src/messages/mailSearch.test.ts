// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { expandQuery, groupByPerson, rankPerson, loadRecents, rememberSearch, MIN_CHARS, type SearchPerson } from "./mailSearch";

// UP-MIND-15. 94% of mail queries are one word and about 40% name a person.
// The rules here are all deterministic: no AI, and an operator the user
// typed is passed through untouched.

const people: SearchPerson[] = [
  { name: "Marco Silva", email: "marco@example.com", label: "Client" },
  { name: "Nadia Brandt", email: "nadia@example.com" },
  { name: "Rob Diaz", email: "rob@example.com", onProject: true },
];

describe("a name becomes a question about that person", () => {
  it("asks for both directions", () => {
    expect(expandQuery("marco", people)).toEqual({
      query: "from:marco@example.com OR to:marco@example.com",
      person: people[0],
    });
  });

  it("leaves a word that is not a name alone", () => {
    expect(expandQuery("invoice", people)).toEqual({ query: "invoice" });
  });

  it("leaves an operator the user typed completely alone", () => {
    expect(expandQuery("from:someone@else.com invoice", people)).toEqual({ query: "from:someone@else.com invoice" });
  });

  it("does not fire on one or two characters", () => {
    expect(expandQuery("ma", people).person).toBeUndefined();
    expect(MIN_CHARS).toBe(3);
  });

  // Two people answering to one name is not a person query. The plain search
  // is the honest answer, and the groups still separate them below.
  it("stays a plain search when the name is ambiguous", () => {
    const two = [...people, { name: "Marco Diaz", email: "marcod@example.com" }];
    expect(expandQuery("marco", two).person).toBeUndefined();
  });
});

describe("who they are to you decides the order", () => {
  it("ranks a label above a project, a project above a stranger", () => {
    expect(rankPerson(people[0])).toBeLessThan(rankPerson(people[2]));
    expect(rankPerson(people[2])).toBeLessThan(rankPerson(people[1]));
    expect(rankPerson(undefined)).toBeGreaterThan(rankPerson(people[1]));
  });

  it("groups the hits and puts the best-known person first", () => {
    const rows = [
      { id: "a", from: "Nadia Brandt", fromEmail: "nadia@example.com", dateMs: 3 },
      { id: "b", from: "Marco Silva", fromEmail: "marco@example.com", dateMs: 2 },
      { id: "c", from: "Marco Silva", fromEmail: "marco@example.com", dateMs: 1 },
      { id: "d", from: "Someone", fromEmail: "who@nowhere.com", dateMs: 0 },
    ];
    const groups = groupByPerson(rows, people);
    expect(groups.map((g) => g.name)).toEqual(["Marco Silva", "Nadia Brandt", "Someone"]);
    expect(groups[0]!.rows).toHaveLength(2);
  });
});

describe("recent searches", () => {
  beforeEach(() => localStorage.clear());

  it("remembers the newest first, without duplicates", () => {
    rememberSearch("roster");
    rememberSearch("invoice");
    rememberSearch("ROSTER");
    expect(loadRecents()).toEqual(["ROSTER", "invoice"]);
  });

  it("keeps a short list", () => {
    for (let i = 0; i < 12; i++) rememberSearch("q" + i);
    expect(loadRecents().length).toBeLessThanOrEqual(6);
  });

  it("never remembers nothing", () => {
    rememberSearch("   ");
    expect(loadRecents()).toEqual([]);
  });
});
