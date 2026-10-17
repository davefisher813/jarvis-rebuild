// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPickSheet from "./LibraryPickSheet";
import type { LibraryEntry } from "./library";
import { EMPTY_CLASS, type ClassStore } from "./classify";
import { pickerRows, pickerSections, adoptStarter, NO_MUSCLE_SECTION } from "./libraryView";
import { readGymSettings, writeGymSettings } from "./settings";
import type { StarterExercise } from "./starterLibrary";

// ONE EXERCISE SOURCE FOR EVERY PICKER (Dave 2026-10-16, Q), AND THE
// PRELOADED CATALOG MERGED INTO IT (S9). "Add to Push Day" stopped at forty
// rows; the empty workout's Add Exercise and Swap searched the raw library
// and offered back an exercise he had archived ("Cable Curls"). Every picker
// lists the library's default view now, uncapped, through LibraryPickSheet,
// with the catalog's entries under the same muscle sections and his own
// marked Yours.

const entry = (i: number, over: Partial<LibraryEntry> = {}): LibraryEntry =>
  ({ key: "k" + i, name: "Lift " + i, kind: "weight_reps", unit: "lb", lastUsed: 1000 - i, lastSets: [], ...over });

const STARTERS: StarterExercise[] = [
  { name: "Bench Press", primary: "chest", secondary: "triceps" },
  { name: "Back Squat", primary: "quads", secondary: "glutes" },
  { name: "Lift 3", primary: "back", secondary: null },
];

beforeEach(() => { localStorage.clear(); });

describe("pickerRows: the library's default view, no cap, the catalog merged in", () => {
  const library = Array.from({ length: 60 }, (_, i) => entry(i));
  const store: ClassStore = { k5: { ...EMPTY_CLASS, archived: true }, k7: { ...EMPTY_CLASS, primary: ["chest"] } };

  it("lists every row the Exercises page lists: no cap, hidden and archived out", () => {
    const rows = pickerRows(library, store, ["k9"], { starters: [] });
    expect(rows).toHaveLength(58);
    expect(rows.find((r) => r.entry.key === "k5"), "archived").toBeUndefined();
    expect(rows.find((r) => r.entry.key === "k9"), "hidden").toBeUndefined();
  });

  it("merges the catalog's entries the athlete does not have, matched by folded name, as starters", () => {
    const rows = pickerRows(library, store, [], { starters: STARTERS });
    const starters = rows.filter((r) => r.starter).map((r) => r.entry.name);
    // "Lift 3" is already his, so the catalog's Lift 3 is not offered twice.
    expect(starters.sort()).toEqual(["Back Squat", "Bench Press"]);
    const bench = rows.find((r) => r.entry.name === "Bench Press")!;
    expect(bench.primary).toBe("chest");
    expect(bench.entry.starter).toEqual({ primary: "chest", secondary: "triceps" });
  });

  it("an archived exercise of the same name keeps its starter out too", () => {
    const rows = pickerRows([entry(1, { name: "Bench Press" })], { k1: { ...EMPTY_CLASS, archived: true } }, [], { starters: STARTERS });
    expect(rows.map((r) => r.entry.name)).not.toContain("Bench Press");
  });

  it("searches the name and the aliases, starters included, and a kind filter keeps starters only for weight and reps", () => {
    const lib = [entry(1, { aliases: ["Old Press"] }), entry(2, { kind: "rounds" })];
    expect(pickerRows(lib, {}, [], { q: "old", starters: STARTERS }).map((r) => r.entry.key)).toEqual(["k1"]);
    expect(pickerRows(lib, {}, [], { q: "squat", starters: STARTERS }).map((r) => r.entry.name)).toEqual(["Back Squat"]);
    expect(pickerRows(lib, {}, [], { kind: "rounds", starters: STARTERS }).map((r) => r.entry.key)).toEqual(["k2"]);
    expect(pickerRows(lib, {}, [], { kind: "weight_reps", starters: STARTERS }).filter((r) => r.starter)).toHaveLength(3);
  });

  it("groups under the primary muscle in the app's order, the unsorted last", () => {
    const sections = pickerSections(pickerRows(library.slice(0, 10), store, [], { starters: STARTERS }));
    // The catalog's "Lift 3" is already his (unclassified), so it brings no Back section with it.
    expect(sections.map((s) => s.label)).toEqual(["Chest", "Quads", NO_MUSCLE_SECTION]);
    expect(sections[0]!.rows.map((r) => r.entry.name).sort()).toEqual(["Bench Press", "Lift 7"]);
  });

  it("adopting a starter mints a fresh key and carries the catalog's muscles as its classification", () => {
    const row = pickerRows([], {}, [], { starters: STARTERS }).find((r) => r.entry.name === "Bench Press")!;
    const a = adoptStarter(row.entry);
    expect(a.entry.key).toMatch(/^ek/);
    expect(a.entry.exerciseKey).toBe(a.entry.key);
    expect(a.entry.starter).toBeUndefined();
    expect(a.seed).toEqual({ key: a.entry.key, name: "Bench Press", kind: "weight_reps" });
    expect(a.cls).toMatchObject({ primary: ["chest"], secondary: ["triceps"], measure: "weight_reps" });
    expect(a.cls.equipment, "a starter carries no equipment").toBeUndefined();
  });
});

describe("LibraryPickSheet lists the default view", () => {
  it("has no cap: sixty rows are sixty rows", () => {
    const library = Array.from({ length: 60 }, (_, i) => entry(i));
    const { container } = render(
      <LibraryPickSheet title="Add to Push Day" library={library} onPick={() => {}} onPickMany={() => {}} onCancel={() => {}} />,
    );
    expect(container.ownerDocument.querySelectorAll(".sheet-list .row")).toHaveLength(60);
  });

  it("leaves an archived exercise out, in every mode", () => {
    writeGymSettings({ ...readGymSettings(), classByKey: { k2: { primary: [], secondary: [], tags: [], archived: true } } });
    const library = [entry(1), entry(2, { name: "Cable Curls" }), entry(3)];
    const { unmount } = render(<LibraryPickSheet title="Swap For" library={library} kindFilter="weight_reps" onPick={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Cable Curls")).toBeNull();
    expect(screen.getByText("Lift 1")).toBeInTheDocument();
    unmount();
    render(<LibraryPickSheet title="Add to Push Day" library={library} onPick={() => {}} onPickMany={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Cable Curls")).toBeNull();
  });

  it("marks the athlete's own rows Yours, once, and draws no mark on a catalog row", () => {
    // The catalog is empty until the approved list lands, so the merge is proved with a fixture through pickerRows above;
    // here the sheet's own rows prove the mark: every row is his, every row says Yours exactly once.
    const library = [entry(1), entry(2, { favorite: true }), entry(3, { kind: "rounds" })];
    const { container } = render(<LibraryPickSheet title="Add Exercise" library={library} onPick={() => {}} onCancel={() => {}} />);
    const rows = Array.from(container.ownerDocument.querySelectorAll(".sheet-list .row"));
    const row1 = rows.find((r) => r.textContent?.includes("Lift 1"))!;
    expect(within(row1 as HTMLElement).getByText("Yours")).toHaveClass("fact");
    // One grey per row: a favourite's mark is its pill; a row that states its kind states only that.
    expect(within(rows.find((r) => r.textContent?.includes("Lift 2")) as HTMLElement).queryByText("Yours")).toBeNull();
    const row3 = rows.find((r) => r.textContent?.includes("Lift 3")) as HTMLElement;
    expect(within(row3).getByText("Rounds")).toHaveClass("conn-meta");
    expect(within(row3).queryByText("Yours")).toBeNull();
    for (const r of rows) expect(r.querySelectorAll(".conn-meta, .row-value .fact").length, "at most one grey").toBeLessThanOrEqual(1);
  });

  it("draws section heads only when there is more than one section", () => {
    writeGymSettings({ ...readGymSettings(), classByKey: { k1: { primary: ["chest"], secondary: [], tags: [] } } });
    const { container, unmount } = render(<LibraryPickSheet title="Add" library={[entry(1), entry(2)]} onPick={() => {}} onCancel={() => {}} />);
    const heads = () => Array.from(container.ownerDocument.querySelectorAll(".sheet-list .eyebrow")).map((e) => e.textContent);
    expect(heads()).toEqual(["Chest", NO_MUSCLE_SECTION]);
    unmount();
    render(<LibraryPickSheet title="Add" library={[entry(2), entry(3)]} onPick={() => {}} onCancel={() => {}} />);
    expect(document.querySelectorAll(".sheet-list .eyebrow")).toHaveLength(0);
  });

  it("a pick hands back the entry; a free-text fallback stays for a name nothing matches", () => {
    const onPick = vi.fn(), onFreeText = vi.fn();
    render(<LibraryPickSheet title="Add Exercise" library={[entry(1)]} onPick={onPick} onFreeText={onFreeText} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Lift 1"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: "k1" }));
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "zercher squat" } });
    fireEvent.click(screen.getByRole("button", { name: /Use .*Anyway/ }));
    expect(onFreeText).toHaveBeenCalledWith("Zercher Squat");
  });
});
