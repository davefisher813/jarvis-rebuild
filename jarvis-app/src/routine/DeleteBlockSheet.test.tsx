// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DeleteBlockSheet, { blockDeleteLines, daysLine } from "./DeleteBlockSheet";
import type { ProtectedBlock } from "./types";

const lunch: ProtectedBlock = { id: "b1", label: "Lunch", startMin: 12 * 60, endMin: 13 * 60, days: [1, 2, 3, 4, 5] };

describe("daysLine", () => {
  it("names the common sets and lists the rest", () => {
    expect(daysLine([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(daysLine([5, 4, 3, 2, 1])).toBe("Weekdays");
    expect(daysLine([6, 0])).toBe("Weekends");
    expect(daysLine([3, 1])).toBe("Mon Wed");
  });
});

describe("blockDeleteLines", () => {
  it("says what the block is as two facts and that it leaves every day", () => {
    const { days, time, goes } = blockDeleteLines(lunch);
    expect(days).toBe("Weekdays");
    expect(time).toBe("12:00 PM to 1:00 PM");
    expect(goes).toEqual(["It Leaves Every Day It Repeats On"]);
  });

  it("counts one-day changes, singular and plural, in Title Case", () => {
    const one = blockDeleteLines({ ...lunch, exceptions: { "2026-10-01": { startMin: 700, endMin: 760 } } } as ProtectedBlock);
    expect(one.goes[1]).toBe("1 One-Day Change Made to It");
    const two = blockDeleteLines({
      ...lunch,
      exceptions: { "2026-10-01": { startMin: 700, endMin: 760 }, "2026-10-02": { startMin: 700, endMin: 760 } },
    } as ProtectedBlock);
    expect(two.goes[1]).toBe("2 One-Day Changes Made to It");
  });
});

// THE CATALOG, CHECKED ON WHAT THE SHEET DRAWS (Dave 2026-10-05). The block's days
// and clock were one string with a dot typed into it, drawn inside one .fact.
describe("DeleteBlockSheet: the catalog (2026-10-05)", () => {
  it("draws the days and the clock as two small-caps date facts, no typed dot, and no line that repeats them", () => {
    render(<DeleteBlockSheet block={lunch} onDelete={() => {}} onCancel={() => {}} />);
    const facts = Array.from(document.querySelectorAll(".dup-name ~ .facts .fact"));
    expect(facts.map((f) => f.textContent)).toEqual(["Weekdays", "12:00 PM to 1:00 PM"]);
    expect(facts.every((f) => f.classList.contains("date"))).toBe(true);
    expect(document.querySelector(".dup-name ~ .facts")!.textContent).not.toContain("\u00b7");
    const goes = Array.from(document.querySelectorAll(".conn-meta")).map((l) => l.textContent);
    expect(goes).toEqual(["It Leaves Every Day It Repeats On"]);
  });
});

describe("DeleteBlockSheet", () => {
  it("deletes only on the destructive button; Cancel and the scrim only cancel", () => {
    const onDelete = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteBlockSheet block={lunch} onDelete={onDelete} onCancel={onCancel} />);
    expect(screen.getByRole("dialog", { name: "Delete Lunch" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete Block" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("locks both buttons while pending", () => {
    render(<DeleteBlockSheet block={lunch} pending onDelete={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Deleting" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
