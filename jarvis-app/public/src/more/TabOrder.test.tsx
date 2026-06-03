// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import EditTabsPage from "./EditTabsPage";

describe("Tab reorder", () => {
  it("shows a Tab order list with a drag handle per enabled tab", () => {
    const { container } = render(
      <EditTabsPage tabKeys={["today", "tasks", "schedule"]} onToggle={() => {}} onReorder={() => {}} onBack={() => {}} />,
    );
    expect(screen.getByText("Tab order")).toBeInTheDocument();
    expect(container.querySelectorAll(".reorder-row").length).toBe(3);
    expect(container.querySelectorAll(".drag-handle").length).toBe(3);
  });
  it("hides Tab order when reorder is unavailable or only one tab", () => {
    render(<EditTabsPage tabKeys={["today"]} onToggle={() => {}} onReorder={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Tab order")).not.toBeInTheDocument();
  });
});
