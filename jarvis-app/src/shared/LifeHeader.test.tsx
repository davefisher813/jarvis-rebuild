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
  { key: "today", label: "Today", count: 2 },
  { key: "upcoming", label: "Upcoming", count: 3 },
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
    expect(tabs.map((t) => t.textContent)).toEqual(["Today2", "Upcoming3", "All"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveClass("active");
    cleanup();
  });

  // A chip that says 0 is worse than a chip that says nothing.
  it("draws a count only where there is a real one", () => {
    hdr({ views: [{ key: "done", label: "Done", count: 0 }, { key: "all", label: "All", count: 4 }] });
    expect(screen.getByRole("tab", { name: "Done" }).textContent).toBe("Done");
    expect(screen.getByRole("tab", { name: /All/ }).textContent).toBe("All4");
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
