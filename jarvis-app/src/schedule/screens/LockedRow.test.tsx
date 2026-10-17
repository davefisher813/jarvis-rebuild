// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import LockedRow from "./LockedRow";
import { useSheetEscape } from "../../shared/useSheetEscape";

// THE TIME TAP ON A PROTECTED BLOCK HOLDS A DRAFT (2026-10-17). The popover it
// used to open wrote on the first change of its clock input: Chrome fires
// change per segment and the iOS wheel fires while it turns, so Escape (which
// taps the scrim) only closed a panel that had already saved the routine.
// DayRow fixed the identical bug on 2026-10-01 with RetimeSheet; this is the
// same sheet on the same tap, and what is pinned is WHEN it writes.

function Host({ children }: { children: React.ReactNode }) {
  useSheetEscape();
  return <>{children}</>;
}

const l = { s: 13 * 60, e: 14 * 60, label: "deep work", id: "dw", kind: "focus", mode: "holds" };

const open = () => {
  const onRetime = vi.fn();
  const onResize = vi.fn();
  const { container } = render(<Host><LockedRow l={l} past={false} onRetime={onRetime} onResize={onResize} /></Host>);
  fireEvent.click(container.querySelector(".sched-time-btn")!);
  return { onRetime, onResize, container };
};

const esc = () => act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });

afterEach(cleanup);

describe("LockedRow: the time tap is the Change Time sheet", () => {
  it("opens as a sheet on the body, not a popover under the row", () => {
    const { container } = open();
    const sheet = document.body.querySelector(".form-sheet")!;
    expect(sheet).toBeInTheDocument();
    expect(sheet.closest(".sched-swipe-wrap"), "outside the row's clip").toBeNull();
    expect(container.querySelector(".time-pop")).toBeNull();
    expect(screen.getByText("Deep Work", { selector: ".eyebrow" }), "it says what it is moving").toBeInTheDocument();
  });

  it("a changed time then Escape writes NOTHING", () => {
    const { onRetime, onResize } = open();
    fireEvent.change(screen.getByLabelText("New time"), { target: { value: "14:30" } });
    expect(onRetime, "the change itself is not the write").not.toHaveBeenCalled();
    esc();
    expect(document.querySelector(".form-sheet"), "Escape closes the sheet").toBeNull();
    expect(onRetime).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("Cancel writes nothing either", () => {
    const { onRetime } = open();
    fireEvent.click(screen.getByText("+30m"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onRetime).not.toHaveBeenCalled();
    expect(document.querySelector(".form-sheet")).toBeNull();
  });

  it("a changed time then Move writes once, with the new start in minutes", () => {
    const { onRetime, onResize } = open();
    fireEvent.change(screen.getByLabelText("New time"), { target: { value: "14:30" } });
    fireEvent.click(screen.getByText("Move"));
    expect(onRetime).toHaveBeenCalledTimes(1);
    expect(onRetime).toHaveBeenCalledWith(14 * 60 + 30, undefined);
    expect(onResize).not.toHaveBeenCalled();
    expect(document.querySelector(".form-sheet")).toBeNull();
  });

  it("a new start and a new length are ONE call, so one write and one Undo", () => {
    const { onRetime, onResize } = open();
    fireEvent.click(screen.getByText("+15m"));
    fireEvent.click(screen.getByLabelText("Deep Work: 90 minutes"));
    fireEvent.click(screen.getByText("Move"));
    expect(onRetime).toHaveBeenCalledTimes(1);
    expect(onRetime).toHaveBeenCalledWith(13 * 60 + 15, 13 * 60 + 15 + 90);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("a length change alone resizes, as the length chips always have", () => {
    const { onRetime, onResize } = open();
    fireEvent.click(screen.getByLabelText("Deep Work: 45 minutes"));
    fireEvent.click(screen.getByText("Move"));
    expect(onResize).toHaveBeenCalledWith(13 * 60 + 45);
    expect(onRetime).not.toHaveBeenCalled();
  });

  it("Move with nothing changed writes nothing", () => {
    const { onRetime, onResize } = open();
    fireEvent.click(screen.getByText("Move"));
    expect(onRetime).not.toHaveBeenCalled();
    expect(onResize).not.toHaveBeenCalled();
  });

  it("the time reads as one phrase, a no-break space between the digits and the meridiem", () => {
    const { container } = render(<LockedRow l={l} past={false} />);
    expect(container.querySelector(".sched-time")!.textContent).toBe("1:00 PM");
  });
});
