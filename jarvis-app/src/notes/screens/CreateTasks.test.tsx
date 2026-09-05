// @vitest-environment jsdom
// HMN-F-14 (2026-09-05): every other sheet in the app got B12's latch; this
// button did not, and tasksFromChecklist is only idempotent once the first
// run has written its taskIds back, so a fast double tap made every task
// twice. The first tap latches and the label says so.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CreateTasks from "./CreateTasks";

const ITEMS = [
  { text: "Milk", due: "", urgency: "muted" as const },
  { text: "Eggs", due: "", urgency: "muted" as const },
];

describe("CreateTasks", () => {
  it("a fast double tap on Create only fires once, and the button says so", () => {
    const onCreate = vi.fn();
    render(<CreateTasks items={ITEMS} onCreate={onCreate} />);
    const btn = screen.getByText("Create 2 Tasks");
    fireEvent.click(btn);
    expect(btn).toHaveTextContent("Creating");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("with nothing to create the button is off", () => {
    const onCreate = vi.fn();
    render(<CreateTasks items={[]} onCreate={onCreate} />);
    const btn = screen.getByText("Create 0 Tasks");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("one item reads as one task", () => {
    render(<CreateTasks items={ITEMS.slice(0, 1)} onCreate={() => {}} />);
    expect(screen.getByText("Create 1 Task")).toBeInTheDocument();
  });
});
