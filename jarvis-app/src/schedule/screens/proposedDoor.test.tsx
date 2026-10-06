// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProposedRow, { HeldProposalRow } from "./ProposedRow";
import SchedulePage from "./SchedulePage";
import type { PlanBlock } from "../planDay";

// SCHEDULE AUDIT 2026-10-01, item 5. "Tasks can't be edited consistently from
// schedule slots": a proposed task NESTED under Deep Work opened the full Edit
// Task sheet, while the same kind of task as a standalone row under Gym
// expanded to duration chips and Book It and had no way to open the editor.
const block: PlanBlock = { taskId: "t1", text: "Finish Jarvis on Mac", category: "work", start: "10:00", end: "10:45" };

// NO PILLS ON A ROW (Dave 2026-10-05, locked). Book It, Edit Task and Move to Anytime used to be three capsules in the
// expanded row. They are the swipe-left rail (Book It, then Anytime), the long-press menu (every one again), and the tap, which
// opens the task's own sheet when an editor is wired.
describe("a standalone proposed row holds its actions in the rail, the menu and the tap", () => {
  const row = (props: Record<string, unknown> = {}, open = false) => {
    const onOpen = vi.fn(), onAccept = vi.fn(), onDrop = vi.fn(), onToggle = vi.fn(), onComplete = vi.fn();
    const r = render(
      <ProposedRow block={block} open={open} onToggle={onToggle} onDuration={() => {}} onDrop={onDrop}
        onAccept={onAccept} onOpen={onOpen} onComplete={onComplete} {...props} />,
    );
    return { onOpen, onAccept, onDrop, onToggle, onComplete, ...r };
  };

  it("draws no capsule in the row, expanded or not", () => {
    const { container } = row({}, true);
    expect(container.querySelectorAll(".pill-act, .row-act, .btn-sm").length).toBe(0);
    expect(screen.queryByText("Edit Task")).toBeNull();
  });

  it("the swipe-left rail leads with Book It and holds the way back to Anytime", () => {
    const { onAccept, onDrop } = row();
    const rail = Array.from(document.querySelectorAll(".sched-actions .sched-act")).map((b) => b.textContent);
    expect(rail).toEqual(["Book It", "Anytime"]);
    fireEvent.click(screen.getByText("Book It"));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Anytime"));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("the long-press menu holds every action again, and Edit Task opens the task", () => {
    const { onOpen, onAccept } = row();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Finish Jarvis on Mac/ }));
    const labels = Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
    expect(labels).toEqual(["Book It", "Done", "Edit Task", "Change Length", "Move to Anytime", "Cancel"]);
    fireEvent.click(screen.getByRole("button", { name: "Edit Task" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("a tap opens the task when an editor is wired, and expands the length chips when not", () => {
    const a = row();
    fireEvent.click(screen.getByText("Finish Jarvis on Mac"));
    expect(a.onOpen).toHaveBeenCalledTimes(1);
    expect(a.onToggle).not.toHaveBeenCalled();
    a.unmount();
    const b = row({ onOpen: undefined });
    fireEvent.click(screen.getByText("Finish Jarvis on Mac"));
    expect(b.onToggle).toHaveBeenCalledTimes(1);
  });

  it("Change Length in the menu is how the chips open, and the chips are kept", () => {
    const { onToggle } = row();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Finish Jarvis on Mac/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change Length" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the duration chips, which the editor door did not replace", () => {
    row({}, true);
    expect(screen.getByLabelText("Finish Jarvis on Mac: 45 minutes")).toBeInTheDocument();
  });

  it("offers only what the caller can honour: no Book It without onAccept, no ring without onComplete", () => {
    row({ onAccept: undefined, onComplete: undefined, onOpen: undefined });
    expect(Array.from(document.querySelectorAll(".sched-actions .sched-act")).map((b) => b.textContent)).toEqual(["Anytime"]);
    expect(document.querySelector(".sched-check")).toBeNull();
    expect(document.querySelector(".task-done-rail")).toBeNull();
  });

  it("the title is Title Case", () => {
    row({}, false);
    expect(document.querySelector(".sched-t")!.textContent).toBe("Finish Jarvis on Mac");
    cleanup();
    render(<ProposedRow block={{ ...block, text: "reply to nadia about ai" }} open={false} onToggle={() => {}} onDuration={() => {}} onDrop={() => {}} />);
    expect(document.querySelector(".sched-t")!.textContent).toBe("Reply to Nadia About AI");
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

  it("the standalone row books from its rail and opens the task from its menu", () => {
    const onOpen = vi.fn();
    const onAccept = vi.fn();
    render(<SchedulePage {...day} proposed={{ ...proposed({ onOpen, onAccept }), openId: "t1" }} />);
    fireEvent.contextMenu(document.querySelector(".sched-proposed")!);
    fireEvent.click(screen.getByRole("button", { name: "Edit Task" }));
    expect(onOpen).toHaveBeenCalledWith("t1");
    fireEvent.click(screen.getByLabelText("Book Finish Jarvis on Mac"));
    expect(onAccept).toHaveBeenCalledWith("t1");
  });

  it("the row nested under a block has no Accept capsule, and books from its menu", () => {
    const onAccept = vi.fn();
    const { container } = render(<SchedulePage {...day} proposed={proposed({ onAccept, onOpen: vi.fn() })} />);
    expect(container.querySelector(".block-held-prop .pill-act")).toBeNull();
    fireEvent.contextMenu(screen.getByText("Reply to Nadia"));
    fireEvent.click(screen.getByRole("button", { name: "Book It" }));
    expect(onAccept).toHaveBeenCalledWith("t2");
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

// A PROPOSED TASK IS TWO LINES (Dave 2026-10-05, the exact spec): the name, then the details on ONE line with the time FIRST:
// "4:45 PM · PROPOSED · 30 Min". Both the standalone row and the one nested in a block, on Today and on the Schedule tab.
describe("a proposed task is the name and one details line that leads with its time", () => {
  const blk: PlanBlock = { taskId: "t9", text: "Cleanup Backend/storage", category: "work", start: "16:45", end: "17:15" };
  const details = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").replace(/\s*·\s*/g, " · ").trim();

  it("the standalone row: no time column, details read time, PROPOSED, length", () => {
    const { container } = render(<ProposedRow block={blk} open={false} onToggle={() => {}} onDuration={() => {}} onDrop={() => {}} />);
    expect(container.querySelector(".sched-time"), "no separate time column").toBeNull();
    expect(container.querySelector(".sched-t")!.textContent).toBe("Cleanup Backend/storage");
    expect(details(container.querySelector(".sched-cat"))).toBe("4:45 PM · Proposed · 30 Min");
    expect(container.querySelectorAll(".sched-cat .fact.date, .sched-cat .fact.st").length).toBe(2);
  });

  it("the row nested in a block says the same", () => {
    const { container } = render(<HeldProposalRow block={blk} onOpen={() => {}} />);
    expect(container.querySelector(".block-held-t")!.textContent).toBe("Cleanup Backend/storage");
    const facts = Array.from(container.querySelectorAll(".block-held-facts > .fact")).map((f) => f.textContent);
    expect(facts).toEqual(["4:45 PM", "Proposed", "30 Min"]);
  });
});
