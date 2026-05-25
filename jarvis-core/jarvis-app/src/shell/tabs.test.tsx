// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TabBar from "./TabBar";
import EditTabsPage from "../more/EditTabsPage";

describe("TabBar", () => {
  it("renders chosen tabs plus a fixed More, highlighting the active one", () => {
    render(<TabBar tabKeys={["today", "tasks", "notes"]} active="tasks" onTab={() => {}} />);
    ["Today", "Tasks", "Notes", "More"].forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    expect(screen.getByText("Tasks").closest(".tab")).toHaveClass("active");
  });

  it("highlights More when the active page is not a tab", () => {
    render(<TabBar tabKeys={["today", "tasks"]} active="brain" onTab={() => {}} />);
    expect(screen.getByText("More").closest(".tab")).toHaveClass("active");
  });
});

describe("EditTabsPage", () => {
  it("toggles a page in or out of the tab bar", () => {
    const onToggle = vi.fn();
    render(<EditTabsPage tabKeys={["today", "tasks", "schedule"]} onToggle={onToggle} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Notes" }));
    expect(onToggle).toHaveBeenCalledWith("notes");
  });

  it("locks the only remaining tab and blocks adding past the max", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<EditTabsPage tabKeys={["today"]} onToggle={onToggle} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Today" }));
    expect(onToggle).not.toHaveBeenCalled(); // can't remove the last tab

    rerender(<EditTabsPage tabKeys={["today", "tasks", "schedule", "brain"]} onToggle={onToggle} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Notes" }));
    expect(onToggle).not.toHaveBeenCalled(); // already at max
  });
});
