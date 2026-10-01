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
  it("states the block and that it leaves every day", () => {
    const { when, goes } = blockDeleteLines(lunch);
    expect(when).toContain("Weekdays");
    expect(goes).toHaveLength(2);
    expect(goes[1]).toBe("It leaves every day it repeats on");
  });

  it("counts one-day changes, singular and plural", () => {
    const one = blockDeleteLines({ ...lunch, exceptions: { "2026-10-01": { startMin: 700, endMin: 760 } } } as ProtectedBlock);
    expect(one.goes[2]).toBe("1 one-day change made to it");
    const two = blockDeleteLines({
      ...lunch,
      exceptions: { "2026-10-01": { startMin: 700, endMin: 760 }, "2026-10-02": { startMin: 700, endMin: 760 } },
    } as ProtectedBlock);
    expect(two.goes[2]).toBe("2 one-day changes made to it");
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
