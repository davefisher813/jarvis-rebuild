// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPickSheet from "./LibraryPickSheet";
import type { LibraryEntry } from "./library";
import { EMPTY_CLASS, type ClassStore } from "./classify";
import { pickerRows, pickerSections, adoptStarter, NO_MUSCLE_SECTION } from "./libraryView";
import { readGymSettings, writeGymSettings } from "./settings";
import { STARTER_EXERCISES, type StarterExercise } from "./starterLibrary";
import { MUSCLE_GROUPS, MUSCLE_LABEL } from "./muscles";

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
  { name: "Bench Press", primary: "chest", secondary: ["triceps", "shoulders"] },
  { name: "Back Squat", primary: "quads", secondary: ["glutes", "hamstrings"] },
  { name: "Lift 3", primary: "back", secondary: [] },
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
    expect(bench.entry.starter).toEqual({ primary: "chest", secondary: ["triceps", "shoulders"] });
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
    expect(a.cls).toMatchObject({ primary: ["chest"], secondary: ["triceps", "shoulders"], measure: "weight_reps" });
    expect(a.cls.equipment, "a starter carries no equipment").toBeUndefined();
  });

  it("a starter with no secondary adopts with an empty secondary list, not a null", () => {
    const row = pickerRows([], {}, [], { starters: STARTERS }).find((r) => r.entry.name === "Lift 3")!;
    expect(adoptStarter(row.entry).cls).toMatchObject({ primary: ["back"], secondary: [] });
  });
});

describe("the real catalog in the picker (Dave's 111, 2026-10-16)", () => {
  it("a fresh athlete with no exercises sees all 111 under the twelve sections, in the app's order", () => {
    const rows = pickerRows([], {}, []);
    expect(rows).toHaveLength(111);
    expect(rows.every((r) => r.starter)).toBe(true);
    const sections = pickerSections(rows);
    expect(sections.map((s) => s.label)).toEqual(MUSCLE_GROUPS.map((m) => MUSCLE_LABEL[m]));
    expect(sections.reduce((n, s) => n + s.rows.length, 0)).toBe(111);
    for (const s of sections) for (const r of s.rows) expect(r.primary).toBe(s.muscle);
  });

  it("an athlete who already has Bench Press sees it once, theirs, never the catalog's copy too", () => {
    const rows = pickerRows([entry(1, { name: "Bench Press" })], { k1: { ...EMPTY_CLASS, primary: ["chest"] } }, []);
    const bench = rows.filter((r) => r.entry.name === "Bench Press");
    expect(bench).toHaveLength(1);
    expect(bench[0]!.starter).toBe(false);
    expect(bench[0]!.entry.key).toBe("k1");
    expect(rows).toHaveLength(111);
    // Spelling folds: "bench-press" typed by hand is the same exercise.
    expect(pickerRows([entry(2, { name: "bench-press" })], {}, []).filter((r) => r.starter && r.entry.name === "Bench Press")).toHaveLength(0);
  });

  it("picking a catalog entry adopts it with its primary and every secondary", () => {
    const dl = pickerRows([], {}, []).find((r) => r.entry.name === "Deadlift")!;
    const a = adoptStarter(dl.entry);
    expect(a.cls).toMatchObject({ primary: ["back"], secondary: ["glutes", "hamstrings", "forearms"], measure: "weight_reps" });
    expect(a.seed).toEqual({ key: a.entry.key, name: "Deadlift", kind: "weight_reps" });
    const lat = pickerRows([], {}, []).find((r) => r.entry.name === "Lateral Raise")!;
    expect(adoptStarter(lat.entry).cls).toMatchObject({ primary: ["shoulders"], secondary: [] });
  });

  it("search reaches the catalog", () => {
    expect(pickerRows([], {}, [], { q: "turkish" }).map((r) => r.entry.name)).toEqual(["Turkish Get-Up"]);
    expect(pickerRows([], {}, [], { q: "SQUAT" }).map((r) => r.entry.name).sort()).toEqual(
      STARTER_EXERCISES.filter((e) => /squat/i.test(e.name)).map((e) => e.name).sort(),
    );
    expect(pickerRows([], {}, [], { q: "zercher" })).toHaveLength(0);
  });
});

describe("LibraryPickSheet lists the default view", () => {
  it("has no cap: sixty rows are sixty rows, and the catalog's 111 ride beside them", () => {
    const library = Array.from({ length: 60 }, (_, i) => entry(i));
    const { container } = render(
      <LibraryPickSheet onAdopt={() => {}} title="Add to Push Day" library={library} onPick={() => {}} onPickMany={() => {}} onCancel={() => {}} />,
    );
    expect(container.ownerDocument.querySelectorAll(".sheet-list .row")).toHaveLength(60 + 111);
  });

  it("a fresh athlete sees the whole catalog under twelve heads, nothing marked Yours", () => {
    const { container } = render(<LibraryPickSheet onAdopt={() => {}} title="Add Exercise" library={[]} onPick={() => {}} onCancel={() => {}} />);
    const doc = container.ownerDocument;
    expect(Array.from(doc.querySelectorAll(".sheet-list .eyebrow")).map((e) => e.textContent)).toEqual(MUSCLE_GROUPS.map((m) => MUSCLE_LABEL[m]));
    expect(doc.querySelectorAll(".sheet-list .row")).toHaveLength(111);
    expect(screen.queryAllByText("Yours")).toHaveLength(0);
    expect(screen.getByText("Turkish Get-Up")).toBeInTheDocument();
    // Every name is drawn exactly as Dave wrote it: the title-caser re-cases none of them.
    const drawn = Array.from(doc.querySelectorAll(".sheet-list .conn-name")).map((e) => e.textContent).sort();
    expect(drawn).toEqual(STARTER_EXERCISES.map((e) => e.name).sort());
  });

  it("an athlete who owns Bench Press sees it once, marked Yours, under Chest", () => {
    writeGymSettings({ ...readGymSettings(), classByKey: { k1: { primary: ["chest"], secondary: ["triceps", "shoulders"], tags: [] } } });
    const { container } = render(<LibraryPickSheet onAdopt={() => {}} title="Add Exercise" library={[entry(1, { name: "Bench Press" })]} onPick={() => {}} onCancel={() => {}} />);
    expect(screen.getAllByText("Bench Press")).toHaveLength(1);
    expect(screen.getAllByText("Yours")).toHaveLength(1);
    expect(container.ownerDocument.querySelectorAll(".sheet-list .row")).toHaveLength(111);
    const chest = Array.from(container.ownerDocument.querySelectorAll(".sheet-list > div")).find((d) => d.querySelector(".eyebrow")?.textContent === "Chest")!;
    expect(within(chest as HTMLElement).getByText("Bench Press")).toBeInTheDocument();
    expect(within(chest as HTMLElement).getByText("Yours")).toHaveClass("fact");
  });

  // ONE WRITER (2026-10-17): the adoption goes to the caller, before the pick,
  // and the sheet writes nothing to GymSettings itself. It used to, when no
  // caller took it, and GymFlow's in-memory copies then overwrote the write.
  it("picking a catalog row adopts it: a fresh key, its muscles handed to onAdopt before the pick, and nothing written by the sheet", () => {
    const calls: string[] = [];
    type Adopted = { entry: LibraryEntry; seed: { key: string; name: string }; cls: { primary: string[]; secondary: string[] } }[];
    const onPick = vi.fn((_e: LibraryEntry) => { calls.push("pick"); });
    const onAdopt = vi.fn((_a: Adopted) => { calls.push("adopt"); });
    render(<LibraryPickSheet onAdopt={onAdopt} title="Add Exercise" library={[]} onPick={onPick} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "deadlift" } });
    fireEvent.click(screen.getByText("Deadlift"));
    expect(onPick).toHaveBeenCalledTimes(1);
    const picked = onPick.mock.calls[0]![0];
    expect(picked.key).toMatch(/^ek/);
    expect(picked.starter).toBeUndefined();
    expect(calls).toEqual(["adopt", "pick"]);
    const adopted = onAdopt.mock.calls[0]![0];
    expect(adopted).toHaveLength(1);
    expect(adopted[0]!.entry).toEqual(picked);
    expect(adopted[0]!.seed).toMatchObject({ key: picked.key, name: "Deadlift" });
    expect(adopted[0]!.cls).toMatchObject({ primary: ["back"], secondary: ["glutes", "hamstrings", "forearms"] });
    const gs = readGymSettings();
    expect(gs.createdLifts ?? []).toEqual([]);
    expect(gs.classByKey?.[picked.key]).toBeUndefined();
    expect(gs.muscleByKey?.[picked.key]).toBeUndefined();
  });

  it("the search field reaches the catalog", () => {
    render(<LibraryPickSheet onAdopt={() => {}} title="Add Exercise" library={[]} onPick={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "curl" } });
    const names = Array.from(document.querySelectorAll(".sheet-list .conn-name")).map((e) => e.textContent);
    expect(names).toEqual(expect.arrayContaining(["Curl", "Hammer Curl", "Nordic Curl", "Wrist Curl"]));
    expect(names.every((n) => /curl/i.test(n ?? ""))).toBe(true);
  });

  it("leaves an archived exercise out, in every mode", () => {
    writeGymSettings({ ...readGymSettings(), classByKey: { k2: { primary: [], secondary: [], tags: [], archived: true } } });
    const library = [entry(1), entry(2, { name: "Cable Curls" }), entry(3)];
    const { unmount } = render(<LibraryPickSheet onAdopt={() => {}} title="Swap For" library={library} kindFilter="weight_reps" onPick={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Cable Curls")).toBeNull();
    expect(screen.getByText("Lift 1")).toBeInTheDocument();
    unmount();
    render(<LibraryPickSheet onAdopt={() => {}} title="Add to Push Day" library={library} onPick={() => {}} onPickMany={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Cable Curls")).toBeNull();
  });

  it("marks the athlete's own rows Yours, once, and draws no mark on a catalog row", () => {
    const library = [entry(1), entry(2, { favorite: true }), entry(3, { kind: "rounds" })];
    const { container } = render(<LibraryPickSheet onAdopt={() => {}} title="Add Exercise" library={library} onPick={() => {}} onCancel={() => {}} />);
    const rows = Array.from(container.ownerDocument.querySelectorAll(".sheet-list .row"));
    const row1 = rows.find((r) => r.textContent?.includes("Lift 1"))!;
    expect(within(row1 as HTMLElement).getByText("Yours")).toHaveClass("fact");
    // One grey per row: a favourite's mark is its pill; a row that states its kind states only that.
    expect(within(rows.find((r) => r.textContent?.includes("Lift 2")) as HTMLElement).queryByText("Yours")).toBeNull();
    const row3 = rows.find((r) => r.textContent?.includes("Lift 3")) as HTMLElement;
    expect(within(row3).getByText("Rounds")).toHaveClass("conn-meta");
    expect(within(row3).queryByText("Yours")).toBeNull();
    for (const r of rows) expect(r.querySelectorAll(".conn-meta, .row-value .fact").length, "at most one grey").toBeLessThanOrEqual(1);
    // A catalog row says nothing in the trailing slot.
    const bench = rows.find((r) => r.textContent?.includes("Bench Press"))!;
    expect(bench.querySelectorAll(".conn-meta, .row-value, .pill")).toHaveLength(0);
    expect(screen.getAllByText("Yours")).toHaveLength(1);
  });

  it("draws section heads only when there is more than one section", () => {
    writeGymSettings({ ...readGymSettings(), classByKey: { k1: { primary: ["chest"], secondary: [], tags: [] } } });
    const { container, unmount } = render(<LibraryPickSheet onAdopt={() => {}} title="Add" library={[entry(1), entry(2)]} onPick={() => {}} onCancel={() => {}} />);
    const heads = () => Array.from(container.ownerDocument.querySelectorAll(".sheet-list .eyebrow")).map((e) => e.textContent);
    // The catalog fills the twelve; the unclassified Lift 2 brings the thirteenth, last.
    expect(heads()).toEqual([...MUSCLE_GROUPS.map((m) => MUSCLE_LABEL[m]), NO_MUSCLE_SECTION]);
    unmount();
    // A kind filter the catalog does not log under (Swap on a rounds exercise) leaves only his two unsorted rows: one section, no head.
    render(<LibraryPickSheet onAdopt={() => {}} title="Swap For" library={[entry(2, { kind: "rounds" }), entry(3, { kind: "rounds" })]} kindFilter="rounds" onPick={() => {}} onCancel={() => {}} />);
    expect(document.querySelectorAll(".sheet-list .eyebrow")).toHaveLength(0);
    expect(document.querySelectorAll(".sheet-list .row")).toHaveLength(2);
  });

  it("a pick hands back the entry; a free-text fallback stays for a name nothing matches", () => {
    const onPick = vi.fn(), onFreeText = vi.fn();
    render(<LibraryPickSheet onAdopt={() => {}} title="Add Exercise" library={[entry(1)]} onPick={onPick} onFreeText={onFreeText} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Lift 1"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: "k1" }));
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "zercher squat" } });
    fireEvent.click(screen.getByRole("button", { name: /Use .*Anyway/ }));
    expect(onFreeText).toHaveBeenCalledWith("Zercher Squat");
  });
});
