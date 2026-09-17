// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import LifeHeader, { OptionsButton, type HeaderView } from "./LifeHeader";
import OptionsSheet from "./OptionsSheet";

// ---------------------------------------------------------------------------
// THE HEADER ITSELF (Dave 2026-09-17, Unified Headers handoff). What the five
// pages get from mounting it, tested once here rather than five times over.
// ---------------------------------------------------------------------------

const VIEWS: HeaderView[] = [
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All" },
];

function hdr(over: Partial<React.ComponentProps<typeof LifeHeader>> = {}) {
  const props = {
    query: "", onQuery: () => {}, placeholder: "Search Tasks",
    addLabel: "New Task", onAdd: () => {},
    views: VIEWS, view: "today", onView: () => {},
    ...over,
  };
  return render(<LifeHeader {...props} />);
}

describe("the search field", () => {
  it("names what it searches, because the page title is off screen by then", () => {
    hdr();
    const f = screen.getByPlaceholderText("Search Tasks");
    expect(f).toHaveAttribute("aria-label", "Search Tasks");
    cleanup();
  });

  it("reports every keystroke", () => {
    const onQuery = vi.fn();
    hdr({ onQuery });
    fireEvent.change(screen.getByPlaceholderText("Search Tasks"), { target: { value: "roof" } });
    expect(onQuery).toHaveBeenCalledWith("roof");
    cleanup();
  });

  it("offers a clear only once there is something to clear", () => {
    hdr();
    expect(screen.queryByLabelText("Clear search")).toBeNull();
    cleanup();
    const onQuery = vi.fn();
    hdr({ query: "roof", onQuery });
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(onQuery).toHaveBeenCalledWith("");
    cleanup();
  });
});

describe("Add", () => {
  it("says Add and means New Task", () => {
    const onAdd = vi.fn();
    hdr({ onAdd });
    const btn = screen.getByLabelText("New Task");
    expect(btn).toHaveTextContent("Add");
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalled();
    cleanup();
  });
});

describe("the view chips", () => {
  it("are one row of tabs, the selected one said out loud", () => {
    hdr();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Today", "Upcoming", "All"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveClass("active");
    cleanup();
  });

  // AMENDED 2026-09-17 (Dave: "Look at what happens to the chips when they
  // slide"). A chip is a label and nothing else. Four chips with counts
  // measure 458px of content at phone width in a 361px row, so the row had to
  // scroll, and a scrolling row of large filled pills is cut in half at every
  // resting position. Without counts the same four measure 335 and the row
  // does not scroll. The approved mockups never had counts here.
  it("carries a label and nothing else, so the row fits without scrolling", () => {
    hdr();
    for (const t of screen.getAllByRole("tab")) {
      expect(t.textContent, "a count would push the row into a scroll").toMatch(/^[A-Za-z ]+$/);
    }
    cleanup();
  });

  it("reports a change, and says nothing when the selected one is tapped", () => {
    const onView = vi.fn();
    hdr({ onView });
    fireEvent.click(screen.getByRole("tab", { name: /Upcoming/ }));
    expect(onView).toHaveBeenCalledWith("upcoming");
    fireEvent.click(screen.getByRole("tab", { name: /Today/ }));
    expect(onView).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

describe("the scope line", () => {
  it("stays away until something is being searched", () => {
    hdr();
    expect(document.querySelector(".hdr-scope")).toBeNull();
    cleanup();
  });

  it("says how many and where it looked, and offers to widen it", () => {
    const onAll = vi.fn();
    hdr({ query: "bridge", scope: { count: 2, where: "Active projects", onAll, allLabel: "Search all projects" } });
    expect(screen.getByText("2 results in Active projects")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Search all projects"));
    expect(onAll).toHaveBeenCalled();
    cleanup();
  });

  it("counts one result as one result", () => {
    hdr({ query: "x", scope: { count: 1, where: "All notes" } });
    expect(screen.getByText("1 result in All notes")).toBeInTheDocument();
    cleanup();
  });

  // The view is already everything, so there is nothing to widen to.
  it("drops the widen control when it would be a no-op", () => {
    hdr({ query: "x", scope: { count: 0, where: "All tasks" } });
    expect(screen.getByText("0 results in All tasks")).toBeInTheDocument();
    expect(document.querySelector(".hdr-scope-all")).toBeNull();
    cleanup();
  });
});

describe("the options sheet", () => {
  it("opens from the bar control and closes on Done", () => {
    const onClick = vi.fn();
    render(<OptionsButton onClick={onClick} label="Notes Options" />);
    fireEvent.click(screen.getByLabelText("Notes Options"));
    expect(onClick).toHaveBeenCalled();
    cleanup();
  });

  it("holds a setting with its answer, and an action without one", () => {
    const pick = vi.fn(); const close = vi.fn();
    render(<OptionsSheet title="Notes Options" onClose={close} rows={[
      { key: "area", label: "Area", value: "All Areas", onClick: pick },
      { key: "del", label: "Recently Deleted", count: 3, onClick: pick },
    ]} />);
    expect(screen.getByText("Area")).toBeInTheDocument();
    expect(screen.getByText("All Areas")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Recently Deleted"));
    expect(pick).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Done"));
    expect(close).toHaveBeenCalled();
    cleanup();
  });

  // A row holding the page's own control is not a door, so it gets no
  // chevron and does not pretend to be tappable.
  it("gives a relocated control its slot and no chevron", () => {
    const { container } = render(<OptionsSheet title="Tasks Options" onClose={() => {}} rows={[
      { key: "group", label: "Group", right: <span data-testid="menu">By Area</span> },
    ]} />);
    void container;
    expect(screen.getByTestId("menu")).toBeInTheDocument();
    expect(document.querySelector(".list-card-ruled .chev")).toBeNull();
    cleanup();
  });
});

// WHY THE ROWS YOU EXPECTED ARE NOT THERE (handoff rule 7: "Add a concise
// visible indication and clear action when filters are applied; do not leave
// users wondering why records disappeared"). With nothing beside the chips,
// this line is what keeps an Area cut from being invisible.
describe("the filter line", () => {
  it("stays away when nothing is narrowing the list", () => {
    hdr();
    expect(document.querySelector(".hdr-scope")).toBeNull();
    cleanup();
  });

  it("names what is narrowing it and clears it in one tap", () => {
    const onClear = vi.fn();
    hdr({ filters: { label: "Overdue \u00b7 Personal", onClear } });
    expect(screen.getByText("Overdue \u00b7 Personal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear"));
    expect(onClear).toHaveBeenCalled();
    cleanup();
  });

  // One line, one job: a search already says its own scope there.
  it("yields to the search scope while a search is running", () => {
    hdr({ query: "x", filters: { label: "Personal", onClear: () => {} }, scope: { count: 2, where: "All tasks" } });
    expect(screen.getByText("2 results in All tasks")).toBeInTheDocument();
    expect(screen.queryByText("Personal")).toBeNull();
    cleanup();
  });
});
