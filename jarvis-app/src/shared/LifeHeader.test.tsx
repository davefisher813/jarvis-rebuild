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

describe("the view menu", () => {
  // AMENDED 2026-09-18 (Dave, on a header wearing two rows: "It should be one
  // line across on every single page. If you drop down, make the chips drop
  // down so everything is on one row directly across").
  //
  // The views were a chip row for a day. A chip row has to fit its WHOLE list
  // on the screen, which is why it lost its counts (four with them: 458px of
  // content in a 361px row), then lost Done, and still left no room for the
  // Area control the same pages need. A menu shows its answer and hands the
  // list to a panel, so it costs the line one capsule whatever it holds.
  it("is one capsule stating the current view, on the header's one control line", () => {
    const { container } = hdr();
    const line = container.querySelector(".hdr-controls")!;
    const dd = line.querySelector('.dd[aria-label="View"]')!;
    expect(dd).toHaveTextContent("Today");
    expect(dd, "the view leads the line").toHaveClass("dd-lead");
    expect(container.querySelector(".hdr-chips"), "no chip row any more").toBeNull();
    cleanup();
  });

  it("holds every view, with the counts a chip could not afford", () => {
    hdr({ views: [
      { key: "today", label: "Today", count: 4 },
      { key: "upcoming", label: "Upcoming", count: 9 },
      { key: "done", label: "Done", count: 40 },
    ] });
    fireEvent.click(screen.getByLabelText("View"));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual(["Today4", "Upcoming9", "Done40"]);
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    cleanup();
  });

  // A label too long for the line says the short word closed and the whole
  // one in the panel, where the choosing happens.
  it("lets a long view name wear a shorter one while closed", () => {
    hdr({ views: [{ key: "deleted", label: "Recently Deleted", short: "Deleted" }], view: "deleted" });
    expect(screen.getByLabelText("View")).toHaveTextContent("Deleted");
    fireEvent.click(screen.getByLabelText("View"));
    expect(screen.getByRole("menuitemradio", { name: "Recently Deleted" })).toBeInTheDocument();
    cleanup();
  });

  it("reports a change, and says nothing when the selected one is picked", () => {
    const onView = vi.fn();
    hdr({ onView });
    fireEvent.click(screen.getByLabelText("View"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Upcoming" }));
    expect(onView).toHaveBeenCalledWith("upcoming");
    fireEvent.click(screen.getByLabelText("View"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Today" }));
    expect(onView).toHaveBeenCalledTimes(1);
    cleanup();
  });

  // THE WHOLE POINT OF THE CHANGE: the cuts share the view's line.
  it("puts the page's own cuts on the same line, after it", () => {
    const { container } = hdr({ drops: <button type="button" className="dd" aria-label="Area">Area</button> });
    const line = [...container.querySelectorAll(".hdr-controls > *")];
    expect(line.map((e) => e.getAttribute("aria-label"))).toEqual(["View", "Area"]);
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
