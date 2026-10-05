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
    expect(screen.getByText("Ends 9:25 AM · Finishing Is Not the Point")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("For"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "45 Min" }));
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

// THE CATALOG HARD GATE (Dave 2026-10-05): every clock is 12-hour with AM/PM, a
// length is the one duration shape ("45 Min"), and no drawn line carries a
// sentence boundary.
describe("RitualSheet: the catalog", () => {
  it("draws the end time 12-hour and the lengths as minutes, never 09:25 or 25m", () => {
    render(<RitualSheet initial={{ ...INITIAL, startHHMM: "13:40" }} onSet={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Ends 2:05 PM · Finishing Is Not the Point")).toBeInTheDocument();
    expect(screen.getByLabelText("For")).toHaveTextContent("25 Min");
    fireEvent.click(screen.getByLabelText("For"));
    expect(screen.getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual(["10 Min", "25 Min", "45 Min"]);
    // No 24-hour clock and no fused "25m" anywhere in what the sheet draws.
    const drawn = [...document.querySelectorAll(".input-hint, .dd, [role=menuitemradio]")].map((e) => e.textContent).join(" | ");
    expect(drawn).not.toMatch(/\b(1[3-9]|2[0-3]):\d\d\b|\b0\d:\d\d\b|\b\d+m\b/);
    expect(document.body.textContent).not.toMatch(/[a-z]\. [A-Z]/);
  });

  it("an end past midnight still reads 12-hour", () => {
    render(<RitualSheet initial={{ ...INITIAL, startHHMM: "23:50" }} onSet={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Ends 12:15 AM · Finishing Is Not the Point")).toBeInTheDocument();
  });
});
