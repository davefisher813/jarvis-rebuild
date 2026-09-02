// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RitualSheet from "./RitualSheet";

const INITIAL = { taskId: "t1", text: "Write the sponsor deck", firstMove: "open the template", startHHMM: "09:00", minutes: 25 };

// The start ritual on the sheet bar (2026-09-02): the task as the first row,
// Starts at the right, For as a menu, Set It in the bar.
describe("RitualSheet", () => {
  it("opens with the plan filled in and sets it with the picked length", () => {
    const onSet = vi.fn();
    render(<RitualSheet initial={INITIAL} onSet={onSet} onCancel={() => {}} />);
    expect(screen.getByText("Write the sponsor deck")).toBeInTheDocument();
    expect(screen.getByText(/^Ends .*Finishing is not the point\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("For"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "45m" }));
    fireEvent.click(screen.getByText("Set It"));
    expect(onSet).toHaveBeenCalledWith({ ...INITIAL, minutes: 45 });
  });

  it("refuses a first move that is not a move, and says why", () => {
    const onSet = vi.fn();
    render(<RitualSheet initial={INITIAL} onSet={onSet} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("First move"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Set It"));
    expect(onSet).not.toHaveBeenCalled();
    expect(screen.getByText(/Name the first move/)).toBeInTheDocument();
  });
});
