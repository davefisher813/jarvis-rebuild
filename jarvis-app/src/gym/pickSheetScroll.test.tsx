// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPickSheet from "./LibraryPickSheet";
import { PickSheet } from "./ActionSheet";
import type { LibraryEntry } from "./library";

// THE SHEET THAT FROZE THE APP (Dave 2026-09-16: "the modal doesn't scroll.
// Can't get out of it. Freezes the whole app and needs a search bar").
//
// .sheet-scrim > .card is a flex column capped at 92% of the visible band.
// Every child declared how it behaves in that column except the results list,
// which was a bare <div> -- and a flex item defaults to min-height: auto, so
// it cannot shrink below its own content. Two dozen lifts grew it past the
// cap, pushed Add and Cancel off the bottom of the screen, and nothing
// scrolled because nothing had been told it was the scroller.
const lib = (n: number): LibraryEntry[] =>
  Array.from({ length: n }, (_, i) => ({ key: "k" + i, name: "Lift " + i, kind: "weight_reps" as const, unit: "lb", sessions: 1, lastUsed: 0, lastSets: [] }));

describe("the pick sheet cannot trap you", () => {
  it("makes the results list the scroll region, not an unshrinkable block", () => {
    const { container } = render(
      <LibraryPickSheet title="Add to Push Day 1" library={lib(40)} onPick={() => {}} onPickMany={() => {}} onCancel={() => {}} />,
    );
    const list = container.ownerDocument.querySelector(".sheet-list");
    expect(list, "the list must be the declared scroller").toBeTruthy();
    expect(list!.querySelector(".list-flat"), "and it must be the thing holding the rows").toBeTruthy();
  });

  it("puts Cancel in a bar at the top, where a long list cannot push it away", () => {
    const onCancel = vi.fn();
    render(<LibraryPickSheet title="Add to Push Day 1" library={lib(40)} onPick={() => {}} onPickMany={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows the count while you pick, not only after you scroll to it", () => {
    const onPickMany = vi.fn();
    render(<LibraryPickSheet title="Add to Push Day 1" library={lib(40)} onPick={() => {}} onPickMany={onPickMany} onCancel={() => {}} />);
    expect(screen.getByText("Add")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Lift 3"));
    fireEvent.click(screen.getByText("Lift 7"));
    expect(screen.getByText("Add 2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add 2"));
    expect(onPickMany).toHaveBeenCalledWith([expect.objectContaining({ key: "k3" }), expect.objectContaining({ key: "k7" })]);
  });

  it("and single-pick mode has the same way out", () => {
    const onCancel = vi.fn();
    render(<LibraryPickSheet title="Swap For" library={lib(40)} onPick={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("the search is the app's own search field, not a bare bordered input", () => {
    const { container } = render(
      <LibraryPickSheet title="Add" library={lib(5)} onPick={() => {}} onPickMany={() => {}} onCancel={() => {}} />,
    );
    const search = container.ownerDocument.querySelector('input[type="search"]');
    expect(search, "a real search input").toBeTruthy();
    expect(search).toHaveClass("xs-input");
    expect(search).toHaveAttribute("aria-label", "Search Exercises");
  });

  it("selections survive a search that hides them", () => {
    const onPickMany = vi.fn();
    render(<LibraryPickSheet title="Add" library={lib(40)} onPick={() => {}} onPickMany={onPickMany} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Lift 3"));
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "Lift 21" } });
    expect(screen.queryByText("Lift 3"), "it is filtered out of the list").toBeNull();
    expect(screen.getByText("Add 1"), "but still picked").toBeInTheDocument();
  });
});

// AND THE SAME DEFECT IN THE OTHER SHEET (Dave 2026-09-18, on the exercise
// picker: "There also needs to be a search in these modals and a way to get
// out of them. They keep freezing my screen").
//
// LibraryPickSheet was fixed on 2026-09-16. PickSheet -- Move to Day, Group
// With, Merge Into, and the exercise pickers on See What Is Changing -- kept
// the bare <div> and froze exactly the same way on a real library.
const picks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i), label: "Lift " + i }));

describe("the generic pick sheet cannot trap you either", () => {
  it("makes its list the scroll region, so the way out cannot be pushed off", () => {
    const { container } = render(<PickSheet title="Exercise" items={picks(20)} onPick={() => {}} onCancel={() => {}} />);
    const list = container.ownerDocument.querySelector(".sheet-list");
    expect(list, "the list must be the declared scroller").toBeTruthy();
    expect(list!.querySelector(".list-flat"), "and it must be the thing holding the rows").toBeTruthy();
  });

  it("keeps Cancel reachable and working", () => {
    const onCancel = vi.fn();
    render(<PickSheet title="Exercise" items={picks(20)} onPick={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  // A LIST LONG ENOUGH TO LOOK THROUGH GETS A SEARCH; A LIST YOU READ AT A
  // GLANCE DOES NOT. Move to Day offers four days and a field above them is
  // furniture.
  it("offers a search once the list passes a glance, and not before", () => {
    const { container, unmount } = render(<PickSheet title="Which Day Is This" items={picks(4)} onPick={() => {}} onCancel={() => {}} />);
    expect(container.ownerDocument.querySelector('input[type="search"]'), "four rows need no search").toBeNull();
    unmount();
    render(<PickSheet title="Exercise" searchLabel="Search Exercises" items={picks(20)} onPick={() => {}} onCancel={() => {}} />);
    const search = document.querySelector('input[type="search"]')!;
    expect(search, "twenty rows do").toBeTruthy();
    expect(search, "the app's own search field, not a bare bordered input").toHaveClass("xs-input");
    expect(search).toHaveAttribute("aria-label", "Search Exercises");
  });

  it("filters to what matches, and says so when nothing does", () => {
    render(<PickSheet title="Exercise" searchLabel="Search Exercises" items={picks(20)} onPick={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "Lift 13" } });
    expect(screen.getByText("Lift 13")).toBeInTheDocument();
    expect(screen.queryByText("Lift 4")).toBeNull();
    // Never "no results": the rows are not missing, the search is narrow.
    fireEvent.change(screen.getByLabelText("Search Exercises"), { target: { value: "zzz" } });
    expect(screen.getByText(/Nothing here matches/)).toBeInTheDocument();
  });

  it("does not unpick what a search hides", () => {
    const onPick = vi.fn();
    render(<PickSheet title="Group With" multi items={picks(20)} confirmLabel={(n) => `Group ${n}`} onPick={onPick} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Lift 3"));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "Lift 12" } });
    expect(screen.queryByText("Lift 3"), "filtered out of the list").toBeNull();
    fireEvent.click(screen.getByText("Group 1"));
    expect(onPick, "but still picked").toHaveBeenCalledWith(["3"]);
  });
});

// THE STYLING FOLLOWED THE SHEET, NOT THE PAGE (2026-09-18). Every sheet in
// this app is a portal to document.body, so .ruled .ex-search never reached
// one: the search bar drew as the browser's bare bordered input on the Add
// from Your Lifts sheet too, and had since the day it was added.
describe("a sheet's search bar is styled inside the sheet", () => {
  it("scopes the search field to the scrim as well as the page", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { join, dirname } = await import("node:path");
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../styles/ruled.css"), "utf8");
    expect(css).toMatch(/\.sheet-scrim \.ex-search \.xs-input/);
    expect(css, "and it keeps its height in the card's flex column").toMatch(/\.sheet-scrim \.ex-search \{ flex-shrink: 0; \}/);
  });
});
