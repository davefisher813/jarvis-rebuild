// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SnoozeSheet from "./SnoozeSheet";

// CHOOSE A BETTER TIME (push E): four quick answers, or a day and a time.
const TUE = "2026-09-15";
const NOW = new Date(`${TUE}T09:30:00`).getTime();

describe("SnoozeSheet", () => {
  it("the quick answers move the occurrence at once", () => {
    const onPick = vi.fn();
    render(<SnoozeSheet title="Meds" fromDate={TUE} today={TUE} now={NOW} onPick={onPick} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("In 15 Minutes"));
    expect(onPick).toHaveBeenLastCalledWith(TUE, "09:45");
    fireEvent.click(screen.getByText("In 1 Hour"));
    expect(onPick).toHaveBeenLastCalledWith(TUE, "10:30");
    fireEvent.click(screen.getByText("This Evening"));
    expect(onPick).toHaveBeenLastCalledWith(TUE, "18:00");
    fireEvent.click(screen.getByText("Tomorrow"));
    expect(onPick).toHaveBeenLastCalledWith("2026-09-16", "08:00");
  });
  it("Use This Time needs a time, then moves to the day and time chosen", () => {
    const onPick = vi.fn();
    render(<SnoozeSheet title="Meds" fromDate={TUE} today={TUE} now={NOW} onPick={onPick} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Use This Time"));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText("Pick a day and a time.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Move to day"), { target: { value: "2026-09-17" } });
    fireEvent.change(screen.getByLabelText("Move to time"), { target: { value: "11:15" } });
    fireEvent.click(screen.getByText("Use This Time"));
    expect(onPick).toHaveBeenCalledWith("2026-09-17", "11:15");
  });
});
