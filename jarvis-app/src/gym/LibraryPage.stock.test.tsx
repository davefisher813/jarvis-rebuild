// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPage from "./LibraryPage";
import type { LibraryRow } from "./libraryEdit";
import type { LibraryEntry } from "./library";
import { EMPTY_CLASS, type ClassStore } from "./classify";
import { stockRows, starterEntries, type Adoption } from "./libraryView";
import { STARTER_EXERCISES, type StarterExercise } from "./starterLibrary";
import { MUSCLE_GROUPS, MUSCLE_LABEL } from "./muscles";

// STOCK AND CUSTOM, ONE PAGE (Dave 2026-10-17: "It should be all exercises.
// Stock and custom"). The 111 preloaded starters were in every picker and not
// on the Exercises page. They are listed under his own now, through the same
// source the pickers read (libraryView.starterEntries), grouped under the
// pickers' twelve muscle heads, and nothing is written for one until he opens
// or changes it, when it is adopted through the flow's one door.

const STARTERS: StarterExercise[] = [
  { name: "Bench Press", primary: "chest", secondary: ["triceps", "shoulders"] },
  { name: "Incline Bench Press", primary: "chest", secondary: ["shoulders", "triceps"] },
  { name: "Back Squat", primary: "quads", secondary: ["glutes", "hamstrings"] },
  { name: "Pull-Up", primary: "back", secondary: ["biceps", "forearms"] },
];

const mine = (over: Partial<LibraryRow> = {}): LibraryRow => ({
  key: "ek-row", exerciseKey: "ek-row", name: "Seal Row", kind: "weight_reps", sessions: 3, sets: 9,
  lastDate: "2026-10-10", firstDate: "2026-09-01", hidden: false, ...over,
});
const asEntry = (r: LibraryRow): LibraryEntry => ({ key: r.key, name: r.name, kind: r.kind, lastUsed: 0, lastSets: [], ...(r.aliases ? { aliases: r.aliases } : {}) });

const base = {
  store: {} as ClassStore,
  todayIso: "2026-10-17",
  onOpen: () => {}, onRename: () => {}, onSetClass: () => {}, onMerge: () => {}, onToggleHidden: () => {},
  onBack: () => {},
};

function page(rows: LibraryRow[], over: Partial<Parameters<typeof LibraryPage>[0]> = {}, starters: StarterExercise[] = STARTERS) {
  const onAdopt = vi.fn<(a: Adoption[]) => void>();
  const stock = { rows: stockRows(rows.map(asEntry), starters), onAdopt };
  const view = render(<LibraryPage {...base} rows={rows} stock={stock} {...over} />);
  return { ...view, onAdopt };
}
const heads = (c: HTMLElement) => [...c.querySelectorAll(".sh2 .t")].map((t) => t.textContent);
const rowOf = (name: string) => screen.getByText(name, { selector: ".ex-name" }).closest(".ex-row") as HTMLElement;

beforeEach(() => { localStorage.clear(); });

describe("the Exercises page lists the stock starters beside his own", () => {
  it("lists his own under Your Exercises, then the catalog under its muscle heads in the app's order", () => {
    const { container } = page([mine()]);
    expect(heads(container)).toEqual(["Your Exercises", "Chest", "Back", "Quads"]);
    const chest = screen.getByText("Chest", { selector: ".sh2 .t" }).closest("div")!.parentElement!;
    expect([...chest.querySelectorAll(".ex-name")].map((n) => n.textContent)).toEqual(["Bench Press", "Incline Bench Press"]);
  });

  it("reads the pickers' own source: one he has, by name or by an old name, is not listed twice", () => {
    const rows = [mine({ name: "Bench Press", key: "ek-b" }), mine({ name: "Front Squat", key: "ek-f", aliases: ["Back Squat"] })];
    page(rows);
    expect(screen.getAllByText("Bench Press", { selector: ".ex-name" })).toHaveLength(1);
    expect(screen.queryByText("Back Squat", { selector: ".ex-name" })).toBeNull();
    expect(stockRows(rows.map(asEntry), STARTERS).map((r) => r.name)).toEqual(starterEntries(rows.map(asEntry), STARTERS).map((e) => e.name));
  });

  it("the whole catalog fits under the twelve heads on a fresh library", () => {
    const { container } = page([], {}, [...STARTER_EXERCISES]);
    expect(container.querySelectorAll(".ex-name")).toHaveLength(111);
    expect(heads(container).slice(1)).toEqual(MUSCLE_GROUPS.map((m) => MUSCLE_LABEL[m]));
  });

  it("writes nothing by listing them, and the badge stays his own count", () => {
    const { container, onAdopt } = page([mine()]);
    expect(onAdopt).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(container.querySelector(".nav-count")).toHaveTextContent("1");
  });

  it("a stock row says what it trains, in the muscle hue, and never No Muscles Yet", () => {
    page([mine()]);
    const bench = rowOf("Bench Press");
    expect(within(bench).getByText("Chest")).toHaveClass("fact", "lime");
    expect(within(bench).getByText("Triceps")).toHaveClass("fact", "lime", "sec");
    expect(within(bench).queryByText("No Muscles Yet")).toBeNull();
    // Never trained: no count, no date, no flag line. One facts line, no grey at all.
    expect(bench.querySelectorAll(".facts")).toHaveLength(1);
  });

  it("with none of his own yet, the page is the catalog, with Add Exercise standing alone in the head", () => {
    const { container } = page([], { onCreate: () => {} });
    expect(screen.queryByText("No Exercises Yet")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Exercise" })).toHaveClass("pill-action");
    // No empty card under his head, and no floor about a list that is not there.
    const yours = screen.getByText("Your Exercises").closest(".sh2")!;
    expect(yours.nextElementSibling).not.toHaveClass("pad-x");
    expect(heads(container)[1]).toBe("Chest");
    expect(screen.queryByText("Nothing matches what you are filtering by")).toBeNull();
    expect(screen.queryByText("Nothing here yet.")).toBeNull();
  });
});

describe("a starter becomes his the moment he touches it, through the one door", () => {
  it("opening one adopts it, with its muscles, and opens the adopted exercise", () => {
    const onOpen = vi.fn();
    const { onAdopt } = page([mine()], { onOpen });
    fireEvent.click(rowOf("Bench Press"));
    expect(onAdopt).toHaveBeenCalledTimes(1);
    const [a] = onAdopt.mock.calls[0]![0];
    expect(a!.seed).toMatchObject({ name: "Bench Press", kind: "weight_reps" });
    expect(a!.cls).toMatchObject({ primary: ["chest"], secondary: ["triceps", "shoulders"] });
    const opened = onOpen.mock.calls[0]![0] as LibraryRow;
    expect(opened.key).toBe(a!.seed.key);
    expect(opened.exerciseKey).toBe(a!.seed.key);
    expect(opened.starter).toBeUndefined();
  });

  it("its menu holds what fits a starter, and no Rename, Merge or Delete", () => {
    page([mine()], { onSetGoal: () => {}, onToggleFavorite: () => {}, onDelete: () => {} });
    fireEvent.click(screen.getByRole("button", { name: "More for Bench Press" }));
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    for (const l of ["Edit Details", "Set Goal", "Add to Favorites", "Hide From Suggestions"]) expect(labels).toContain(l);
    for (const l of ["Rename", "Merge Into Another Exercise", "Delete Exercise"]) expect(labels).not.toContain(l);
  });

  it("starring and hiding run on the adopted exercise", () => {
    const onToggleFavorite = vi.fn();
    const onToggleHidden = vi.fn();
    const { onAdopt } = page([mine()], { onToggleFavorite, onToggleHidden });
    fireEvent.click(screen.getByRole("button", { name: "More for Back Squat" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide From Suggestions" }));
    const hidden = onToggleHidden.mock.calls[0]![0] as LibraryRow;
    expect(hidden.key).toBe(onAdopt.mock.calls[0]![0][0]!.seed.key);
    expect(hidden.name).toBe("Back Squat");
  });

  it("Edit Details opens on the catalog's muscles, asks no scope, and its save is the adoption", () => {
    const onSetClass = vi.fn();
    const { onAdopt } = page([mine()], { onSetClass });
    fireEvent.click(screen.getByRole("button", { name: "More for Pull-Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Details" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSetClass).not.toHaveBeenCalled();
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onAdopt.mock.calls[0]![0][0]!.cls).toMatchObject({ primary: ["back"], secondary: ["biceps", "forearms"] });
  });

  it("Cancel on the details adopts nothing", () => {
    const { onAdopt } = page([mine()]);
    fireEvent.click(screen.getByRole("button", { name: "More for Pull-Up" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Details" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAdopt).not.toHaveBeenCalled();
  });
});

describe("search, filters and the other page actions with stock rows on it", () => {
  it("search reaches the catalog, and a muscle with nothing left draws no head", () => {
    const { container } = page([mine()]);
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "squat" } });
    expect(heads(container)).toEqual(["Your Exercises", "Quads"]);
    expect(screen.getByText("Back Squat", { selector: ".ex-name" })).toBeInTheDocument();
  });

  it("a muscle filter takes in the catalog; Favorites, which only his own can be, leaves it out", () => {
    const { container } = page([mine()], { store: { "ek-row": { ...EMPTY_CLASS, primary: ["back"] } } });
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    // The muscle chip, not the nav bar's Back.
    fireEvent.click(screen.getAllByRole("button", { name: "Back" }).find((b) => b.classList.contains("chip"))!);
    expect(screen.getByText("Pull-Up", { selector: ".ex-name" })).toBeInTheDocument();
    expect(screen.queryByText("Bench Press", { selector: ".ex-name" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    expect(container.querySelectorAll(".sh2 .t")).toHaveLength(1);
  });

  it("merge offers his own exercises only, never a starter", () => {
    page([mine(), mine({ key: "ek-2", exerciseKey: "ek-2", name: "Chest Row" })]);
    fireEvent.click(screen.getByRole("button", { name: "More for Seal Row" }));
    fireEvent.click(screen.getByRole("button", { name: "Merge Into Another Exercise" }));
    const sheet = screen.getByText("Merge Seal Row Into").closest(".card") as HTMLElement;
    expect(within(sheet).getByText("Chest Row")).toBeInTheDocument();
    expect(within(sheet).queryByText("Bench Press")).toBeNull();
  });

  it("Select is for his own: the catalog steps aside while selecting", () => {
    const { container } = page([mine()], { onBatch: () => {} });
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    expect(heads(container)).toEqual(["Your Exercises"]);
    fireEvent.click(screen.getByRole("button", { name: "Select All Shown" }));
    expect(screen.getByText("1 Selected")).toBeInTheDocument();
  });

  it("a stock row has no swipe Delete", () => {
    page([mine()], { onDelete: () => {}, onToggleFavorite: () => {} });
    expect(screen.getByRole("button", { name: "Delete Seal Row" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Bench Press" })).toBeNull();
  });
});
