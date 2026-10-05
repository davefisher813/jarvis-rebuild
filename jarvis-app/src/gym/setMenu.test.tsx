// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import SetStrip from "./SetStrip";
import type { SetEntry } from "./types";

// LONG PRESS IS THE ROW'S CONTEXT MENU (Dave 2026-10-05, locked). A logged set opens a RowActionSheet on a hold: Skip (the
// swipe's quick verb), Duplicate (the editor's other move), Delete last. Mid-lift the tray never slides open under the thumb.
const hold = (el: Element) => { fireEvent.touchStart(el, { touches: [{ clientX: 10, clientY: 10 }] }); act(() => { vi.advanceTimersByTime(520); }); };
const menu = () => Array.from(document.querySelectorAll(".action-sheet button")).map((b) => b.textContent);
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("a set chip: the hold opens its menu", () => {
  const entries: SetEntry[] = [{ id: "s1", w: 100, r: 5, done: true } as SetEntry];
  it("lists Skip, Duplicate, Delete; Skip runs the same patch the swipe does", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { container } = render(<SetStrip kind="weight_reps" unit="lb" entries={entries} onChange={onChange} />);
    const chip = container.querySelector(".set-chip")!;
    hold(chip);
    expect(menu()).toEqual(["Skip", "Duplicate", "Delete", "Cancel"]);
    expect(document.querySelector(".action-sheet .destructive")!.textContent).toBe("Delete");
    expect((chip as HTMLElement).style.transform, "no tray under the thumb").toBe("");
    fireEvent.click(screen.getByText("Skip", { selector: ".action-sheet button" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0][0]).toMatchObject({ id: "s1", skipped: true, done: false });
  });

  it("a skipped set offers Unskip", () => {
    vi.useFakeTimers();
    const { container } = render(<SetStrip kind="weight_reps" unit="lb" entries={[{ ...entries[0]!, skipped: true }]} onChange={() => {}} />);
    hold(container.querySelector(".set-chip")!);
    expect(menu()).toEqual(["Unskip", "Duplicate", "Delete", "Cancel"]);
  });

  it("a disabled strip opens nothing", () => {
    vi.useFakeTimers();
    const { container } = render(<SetStrip kind="weight_reps" unit="lb" entries={entries} onChange={() => {}} disabled />);
    hold(container.querySelector(".set-chip")!);
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });
});
