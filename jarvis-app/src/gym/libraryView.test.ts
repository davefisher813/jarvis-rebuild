import { describe, it, expect } from "vitest";
import type { LibraryRow } from "./libraryEdit";
import { EMPTY_CLASS, type ClassStore } from "./classify";
import { filterCount, floorLine, matchesQuery, NO_FILTER, viewRows } from "./libraryView";

// FINDING ONE EXERCISE IN A LIBRARY OF TWO HUNDRED (handoff §3).

const row = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: "k", name: "Bench Press", kind: "weight_reps", sessions: 1, sets: 3,
  lastDate: "2026-09-10", firstDate: "2026-01-01", hidden: false, ...over,
});

const rows: LibraryRow[] = [
  row({ key: "a", name: "Bench Press", sessions: 9, sets: 30, lastDate: "2026-09-08" }),
  row({ key: "b", name: "Back Squat", sessions: 2, sets: 8, lastDate: "2026-09-11", aliases: ["Squat", "BS"] }),
  row({ key: "c", name: "Calf Raise", sessions: 0, sets: 0, lastDate: null }),
  row({ key: "d", name: "Old Press", sessions: 1, sets: 2, lastDate: "2026-01-02", hidden: true }),
];

const store: ClassStore = {
  a: { ...EMPTY_CLASS, primary: ["chest"], secondary: ["triceps"], equipment: "barbell", movement: "push_h" },
  b: { ...EMPTY_CLASS, primary: ["quads"], equipment: "barbell", movement: "squat" },
  c: { ...EMPTY_CLASS, archived: true },
};

describe("search", () => {
  it("matches the name and every alias", () => {
    expect(matchesQuery(rows[1]!, "back")).toBe(true);
    expect(matchesQuery(rows[1]!, "squat")).toBe(true);
    expect(matchesQuery(rows[1]!, "bs")).toBe(true);
    expect(matchesQuery(rows[1]!, "bench")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesQuery(rows[0]!, "   ")).toBe(true);
  });
});

describe("viewRows", () => {
  it("hides the hidden and the archived, and says how many of each", () => {
    const v = viewRows(rows, store, NO_FILTER, "recent");
    expect(v.rows.map((r) => r.key)).toEqual(["b", "a"]);
    expect(v.hiddenAway).toBe(1);
    expect(v.archivedAway).toBe(1);
  });

  it("shows them when asked", () => {
    const v = viewRows(rows, store, { q: "", showHidden: true, showArchived: true }, "name");
    expect(v.rows.map((r) => r.key)).toEqual(["b", "a", "c", "d"]);
  });

  it("filters by muscle in either role", () => {
    expect(viewRows(rows, store, { q: "", muscle: "triceps" }, "recent").rows.map((r) => r.key)).toEqual(["a"]);
    expect(viewRows(rows, store, { q: "", muscle: "quads" }, "recent").rows.map((r) => r.key)).toEqual(["b"]);
  });

  it("filters by equipment and movement", () => {
    expect(viewRows(rows, store, { q: "", equipment: "barbell" }, "name").rows).toHaveLength(2);
    expect(viewRows(rows, store, { q: "", movement: "squat" }, "name").rows.map((r) => r.key)).toEqual(["b"]);
  });

  it("filters to the ones with no primary muscle", () => {
    // c is archived, so the missing filter alone does not surface it.
    expect(viewRows(rows, store, { q: "", missing: true }, "name").rows).toHaveLength(0);
    expect(viewRows(rows, store, { q: "", missing: true, showArchived: true, showHidden: true }, "name").rows.map((r) => r.key))
      .toEqual(["c", "d"]);
  });

  it("filters to favorites and to the duplicate pairs", () => {
    const withFav = rows.map((r) => (r.key === "a" ? { ...r, favorite: true } : r));
    expect(viewRows(withFav, store, { q: "", favorites: true }, "name").rows.map((r) => r.key)).toEqual(["a"]);
    expect(viewRows(rows, store, { q: "", dupes: true }, "name", new Set(["b"])).rows.map((r) => r.key)).toEqual(["b"]);
  });

  it("sorts three ways, and a never-trained exercise never leads the recency list", () => {
    expect(viewRows(rows, store, { q: "", showArchived: true, showHidden: true }, "recent").rows.map((r) => r.key))
      .toEqual(["b", "a", "d", "c"]);
    expect(viewRows(rows, store, { q: "", showArchived: true, showHidden: true }, "name").rows.map((r) => r.key))
      .toEqual(["b", "a", "c", "d"]);
    expect(viewRows(rows, store, { q: "", showArchived: true, showHidden: true }, "most").rows.map((r) => r.key))
      .toEqual(["a", "b", "d", "c"]);
  });

  it("counts the active filters, ignoring the search box", () => {
    expect(filterCount({ q: "bench" })).toBe(0);
    expect(filterCount({ q: "", muscle: "chest", favorites: true })).toBe(2);
  });
});

describe("the floor", () => {
  it("says the whole list when nothing is out of sight", () => {
    const clean = [rows[0]!, rows[1]!];
    const v = viewRows(clean, { a: store.a!, b: store.b! }, NO_FILTER, "name");
    expect(floorLine(v, clean.length, NO_FILTER)).toBe("That's every exercise you have, all 2.");
  });

  it("accounts for every kind of absence", () => {
    const v = viewRows(rows, store, NO_FILTER, "name");
    // capAfterNumber owns the casing: a number hands its edge slot to the
    // word behind it, in every dot segment.
    expect(floorLine(v, rows.length, NO_FILTER)).toBe("2 of 4 Shown · 1 Hidden · 1 Archived.");
  });

  it("says what was searched for when nothing matched", () => {
    const f = { q: "zzz" };
    const v = viewRows(rows, store, f, "name");
    expect(floorLine(v, rows.length, f)).toBe('Nothing matches "zzz".');
  });

  it("has a floor even with nothing in the library", () => {
    const v = viewRows([], {}, NO_FILTER, "name");
    expect(floorLine(v, 0, NO_FILTER)).toBe("Nothing here yet.");
  });
});
