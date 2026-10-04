// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import StartScreen, { type StartAck } from "./StartScreen";
import { startAction, type StartTarget } from "../startAction";
import { START_KEY } from "../startStore";

// Start, act, acknowledge, resume: the acknowledgment is state on the
// screen, not a timed toast, and nothing here blocks the next move.
const target: StartTarget = {
  kind: "task", id: "t1", title: "Plan the trip",
  data: { text: "Plan the trip", category: "life", done: false, steps: [{ text: "Pick dates", done: false }, { text: "Book flights", done: false }] },
};
const action = startAction(target);
const noop = async () => null;

const props = {
  target, action, onDraftChange: () => {}, onPrimary: noop, onBack: () => {}, onInTheWay: () => {},
};

beforeEach(() => { localStorage.removeItem(START_KEY); });

const ack = (over: Partial<StartAck> = {}): StartAck => ({
  line: "Step Done · 1 of 2 Complete", done: 1, total: 2, allDone: false, canUndo: true, nonce: 1, ...over,
});

describe("StartScreen: progress and acknowledgment", () => {
  it("shows one labelled count and a fill, never a percentage", () => {
    const { container } = render(<StartScreen {...props} progress={{ done: 1, total: 4 }} />);
    expect(screen.getByText("1 of 4 Complete")).toBeInTheDocument();
    const fill = container.querySelector(".fb-fill") as HTMLElement;
    expect(fill.style.getPropertyValue("--p")).toBe("25");
    expect(container.textContent).not.toMatch(/%/);
  });

  it("shows no progress when the task has no steps", () => {
    const { container } = render(<StartScreen {...props} progress={{ done: 0, total: 0 }} />);
    expect(container.querySelector(".fb-progress")).toBeNull();
  });

  it("the acknowledgment sits in a polite live region that is always present", () => {
    const { container, rerender } = render(<StartScreen {...props} />);
    const region = container.querySelector('[role="status"]') as HTMLElement;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(within(region).queryByText(/Step Done/)).toBeNull();
    rerender(<StartScreen {...props} ack={ack()} />);
    expect(within(container.querySelector('[role="status"]') as HTMLElement).getByText("Step Done · 1 of 2 Complete")).toBeInTheDocument();
  });

  it("the words carry the news without colour, motion or sound", () => {
    render(<StartScreen {...props} ack={ack()} />);
    expect(screen.getByText("Step Done · 1 of 2 Complete")).toBeVisible();
  });

  it("Undo is offered only when there is an exact state to put back, and it is one tap", () => {
    const onUndo = vi.fn();
    const { rerender } = render(<StartScreen {...props} ack={ack({ canUndo: false })} onUndoAck={onUndo} />);
    expect(screen.queryByText("Undo")).toBeNull();
    rerender(<StartScreen {...props} ack={ack()} onUndoAck={onUndo} />);
    fireEvent.click(screen.getByText("Undo"));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("the primary button is never replaced or disabled by an acknowledgment", () => {
    const { container } = render(<StartScreen {...props} ack={ack()} />);
    const primary = container.querySelectorAll(".btn-primary");
    expect(primary).toHaveLength(1);
    expect(primary[0]).not.toBeDisabled();
  });

  it("the last step is a stopping point and the task is not closed from here", () => {
    const onFinish = vi.fn();
    render(<StartScreen {...props} onFinish={onFinish} ack={ack({ allDone: true, done: 2, total: 2, line: "All Done Here · Close the Task When Ready" })} />);
    expect(screen.getByText("Nothing Left Here")).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Add Another Move"));
    expect(screen.queryByText("Nothing Left Here")).toBeNull();
  });

  it("shows when it was last worked on as a plain fact", () => {
    render(<StartScreen {...props} lastWorked="Last Worked on Yesterday" />);
    expect(screen.getByText("Last Worked on Yesterday")).toBeInTheDocument();
  });
});

describe("StartScreen: edit, smaller, worked on it, done for now", () => {
  it("Edit This Move saves the reworded step and closes", async () => {
    const onEditStep = vi.fn(async () => true);
    render(<StartScreen {...props} onEditStep={onEditStep} />);
    fireEvent.click(screen.getByText("Edit This Move"));
    const box = screen.getByLabelText("Reword this move");
    expect(box).toHaveValue("Pick dates");
    fireEvent.change(box, { target: { value: "Open the calendar" } });
    fireEvent.click(screen.getByText("Save Change"));
    await waitFor(() => expect(onEditStep).toHaveBeenCalledWith("Open the calendar"));
    await waitFor(() => expect(screen.queryByLabelText("Reword this move")).toBeNull());
  });

  it("Make this smaller asks for the person's own smaller move; blank is not accepted", async () => {
    const onSmallerStep = vi.fn(async () => true);
    render(<StartScreen {...props} onSmallerStep={onSmallerStep} />);
    fireEvent.click(screen.getByText("Make this smaller"));
    const save = screen.getByText("Save Smaller Move");
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("A smaller first move"), { target: { value: "Open the calendar" } });
    fireEvent.click(save);
    await waitFor(() => expect(onSmallerStep).toHaveBeenCalledWith("Open the calendar"));
  });

  it("a save that fails keeps the editor and the words open", async () => {
    const onEditStep = vi.fn(async () => false);
    render(<StartScreen {...props} onEditStep={onEditStep} />);
    fireEvent.click(screen.getByText("Edit This Move"));
    fireEvent.change(screen.getByLabelText("Reword this move"), { target: { value: "Kept words" } });
    fireEvent.click(screen.getByText("Save Change"));
    await waitFor(() => expect(onEditStep).toHaveBeenCalled());
    expect(screen.getByLabelText("Reword this move")).toHaveValue("Kept words");
  });

  it("Worked on It logs with no note required and never completes anything", async () => {
    const onWorked = vi.fn(async () => true);
    const onFinish = vi.fn();
    render(<StartScreen {...props} onWorked={onWorked} onFinish={onFinish} />);
    fireEvent.click(screen.getByText("Worked on It"));
    fireEvent.click(screen.getByText("Log It"));
    await waitFor(() => expect(onWorked).toHaveBeenCalledWith(""));
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("Cancel closes the editor and changes nothing", () => {
    const onEditStep = vi.fn(async () => true);
    render(<StartScreen {...props} onEditStep={onEditStep} />);
    fireEvent.click(screen.getByText("Edit This Move"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByLabelText("Reword this move")).toBeNull();
    expect(onEditStep).not.toHaveBeenCalled();
  });

  it("Done for Now is penalty free: one tap, no reason asked, no failure words", () => {
    const onDoneForNow = vi.fn();
    const { container } = render(<StartScreen {...props} onDoneForNow={onDoneForNow} />);
    fireEvent.click(screen.getByText("Done for Now"));
    expect(onDoneForNow).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/unfinished|incomplete|give up|failed|overdue|behind/i);
  });
});
