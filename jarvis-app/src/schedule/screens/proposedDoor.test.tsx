// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProposedRow from "./ProposedRow";
import SchedulePage from "./SchedulePage";
import type { PlanBlock } from "../planDay";

// SCHEDULE AUDIT 2026-10-01, item 5. "Tasks can't be edited consistently from
// schedule slots": a proposed task NESTED under Deep Work opened the full Edit
// Task sheet, while the same kind of task as a standalone row under Gym
// expanded to duration chips and Book It and had no way to open the editor.
const block: PlanBlock = { taskId: "t1", text: "Finish Jarvis on Mac", category: "work", start: "10:00", end: "10:45" };

describe("a standalone proposed row can open its task", () => {
  const row = (props: Record<string, unknown> = {}, open = true) => {
    const onOpen = vi.fn();
    render(
      <ProposedRow block={block} open={open} onToggle={() => {}} onDuration={() => {}} onDrop={() => {}}
        onAccept={() => {}} onOpen={onOpen} {...props} />,
    );
    return { onOpen };
  };

  it("offers Edit Task beside Book It once the row is expanded", () => {
    const { onOpen } = row();
    expect(screen.getByText("Book It")).toBeInTheDocument();
    expect(screen.getByText("Move to Anytime")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Edit Task"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the duration chips, which the editor door did not replace", () => {
    row();
    expect(screen.getByLabelText("Finish Jarvis on Mac: 45 minutes")).toBeInTheDocument();
  });

  it("is absent when the caller has no editor wired, and when the row is shut", () => {
    row({ onOpen: undefined });
    expect(screen.queryByText("Edit Task")).toBeNull();
  });

  it("is not there while the row is collapsed", () => {
    row({}, false);
    expect(screen.queryByText("Edit Task")).toBeNull();
  });
});

describe("on the Schedule tab, tapping a proposed task answers the same way wherever it sits", () => {
  const nested: PlanBlock = { taskId: "t2", text: "Reply to Nadia", category: "work", start: "13:15", end: "13:45" };
  const day = {
    year: 2026, month: 9, selected: "2026-10-01", todayDate: "2026-10-01",
    dots: {} as Record<number, string[]>, dayEvents: [], mode: "day" as const,
    locked: [{ s: 13 * 60, e: 15 * 60, label: "Deep Work", kind: "focus", mode: "holds" }],
    windowStartMin: 8 * 60, windowEndMin: 21 * 60,
  };
  const proposed = (extra: Record<string, unknown> = {}) => ({
    blocks: [block, nested], openId: null,
    onToggle: vi.fn(), onDuration: vi.fn(), onDrop: vi.fn(), onAccept: vi.fn(), ...extra,
  });

  it("the standalone row opens the task from Edit Task, and books from Book It", () => {
    const onOpen = vi.fn();
    const onAccept = vi.fn();
    render(<SchedulePage {...day} proposed={{ ...proposed({ onOpen, onAccept }), openId: "t1" }} />);
    fireEvent.click(screen.getByText("Edit Task"));
    expect(onOpen).toHaveBeenCalledWith("t1");
    fireEvent.click(screen.getByText("Book It"));
    expect(onAccept).toHaveBeenCalledWith("t1");
  });

  it("the row nested under a block opens the same task editor on a tap", () => {
    const onOpen = vi.fn();
    const p = proposed({ onOpen });
    render(<SchedulePage {...day} proposed={p} />);
    fireEvent.click(screen.getByText("Reply to Nadia"));
    expect(onOpen).toHaveBeenCalledWith("t2");
    expect(p.onToggle, "no longer a toggle that nothing draws").not.toHaveBeenCalled();
  });

  it("without an editor wired the nested tap is the toggle it always was", () => {
    const p = proposed();
    render(<SchedulePage {...day} proposed={p} />);
    fireEvent.click(screen.getByText("Reply to Nadia"));
    expect(p.onToggle).toHaveBeenCalledWith("t2");
  });
});
