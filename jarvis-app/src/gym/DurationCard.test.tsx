// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DurationCard from "./DurationCard";
import type { WorkoutData } from "./types";

// The approved Health design (2026-09-14), item 9: the 627-minute session is
// shown as it was made and corrected with its original kept.
const start = new Date("2026-09-12T18:45:00").getTime();
const base: WorkoutData = {
  programId: "p", dayId: "d", dayName: "Pull Day", date: "2026-09-12", startedAt: start, endedAt: start + 627 * 60000,
  exercises: [{ exerciseId: "e", name: "Row", kind: "weight_reps", unit: "lb", sets: [{ id: "a", w: 135, r: 8, at: start + 5 * 60000 }, { id: "b", w: 135, r: 8, at: start + 42 * 60000 }] }],
};

describe("DurationCard", () => {
  it("says how the minutes were made, flags the left-open session, and ends it at the last set with a revision", () => {
    const onCorrect = vi.fn();
    render(<DurationCard workout={base} onCorrect={onCorrect} />);
    expect(screen.getAllByText("627 Min").length).toBe(2);
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("37 Min")).toBeInTheDocument();
    fireEvent.click(screen.getByText("End at the Last Set"));
    expect(onCorrect).toHaveBeenCalledWith(start + 42 * 60000, expect.objectContaining({ field: "endedAt", from: base.endedAt, to: start + 42 * 60000 }));
  });
  it("takes a typed end time, reads a time before the start as the next morning, and lists past corrections", () => {
    const onCorrect = vi.fn();
    const revised: WorkoutData = { ...base, revisions: [{ at: 1, field: "endedAt", from: base.endedAt, to: start + 40 * 60000 }] };
    render(<DurationCard workout={revised} onCorrect={onCorrect} />);
    expect(screen.getByText("Corrected")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Set the End Time"));
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "19:30" } });
    fireEvent.click(screen.getByText("Save"));
    const to = onCorrect.mock.calls[0]![0] as number;
    expect(new Date(to).getHours()).toBe(19);
    expect(new Date(to).getDate()).toBe(12);
    fireEvent.click(screen.getByText("Set the End Time"));
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "01:10" } });
    fireEvent.click(screen.getByText("Save"));
    expect(new Date(onCorrect.mock.calls[1]![0] as number).getDate()).toBe(13);
  });
  it("only reads without the seam", () => {
    render(<DurationCard workout={base} />);
    expect(screen.queryByText("Set the End Time")).toBeNull();
  });
});
