// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import LibraryPickSheet from "./LibraryPickSheet";
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
