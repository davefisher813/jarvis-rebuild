// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import EditTabsPage from "./EditTabsPage";

describe("Tab reorder", () => {
  it("shows a Tab order list, with no grip at rest and one per enabled tab while Reorder is on", () => {
    const { container } = render(
      <EditTabsPage tabKeys={["today", "life", "schedule"]} onToggle={() => {}} onReorder={() => {}} onBack={() => {}} />,
    );
    expect(screen.getByText("Tab Order")).toBeInTheDocument();
    expect(container.querySelectorAll(".reorder-row").length).toBe(3);
    // LOCKED (Dave 2026-10-05): no grip dots and no always-visible hints. The head's capsule turns them on.
    expect(container.querySelectorAll(".drag-handle").length, "no permanent grip").toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Reorder" }));
    expect(container.querySelectorAll(".drag-handle").length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(container.querySelectorAll(".drag-handle").length).toBe(0);
  });
  it("hides Tab order when reorder is unavailable or only one tab", () => {
    render(<EditTabsPage tabKeys={["today"]} onToggle={() => {}} onReorder={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Tab Order")).not.toBeInTheDocument();
  });
});
