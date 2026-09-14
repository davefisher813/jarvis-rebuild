// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PointAtItScreen from "./PointAtItScreen";
import type { StillTherePattern } from "../timelines";

// BRAIN-F-26 (2026-09-05, fork option A): "Hand It to Someone" dialled 988
// from a body-pain screen anywhere on earth, and it connects in two countries.
// The row is offered when there is somebody real behind it, and withheld when
// there is not: a number that does not connect is worse than no number.

const PATTERN: StillTherePattern[] = [{ spotKey: "0.5,0.4", side: "front", sessions: 3, days: 9, firstAt: 1, lastAt: 2 }];

describe("Still There? and who it hands you to", () => {
  it("offers the row, and calls back, when there is somebody to reach", () => {
    const onHandToSomeone = vi.fn();
    render(<PointAtItScreen patterns={PATTERN} onLog={() => {}} onBack={() => {}} onHandToSomeone={onHandToSomeone} />);
    fireEvent.click(screen.getByText("Hand It to Someone"));
    expect(onHandToSomeone).toHaveBeenCalled();
  });

  it("withholds the row when there is nobody, and still shows the pattern", () => {
    render(<PointAtItScreen patterns={PATTERN} onLog={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Still There?")).toBeInTheDocument();
    expect(screen.getByText("Same Spot, 3 Sessions")).toBeInTheDocument();
    expect(screen.queryByText("Hand It to Someone")).not.toBeInTheDocument();
  });
});

// Health Push D, H-46 (2026-09-12): the list beside the map.
describe("the list beside the map", () => {
  it("logs a named region at its own coordinate on its own side, once", () => {
    const onLog = vi.fn();
    render(<PointAtItScreen patterns={[]} onLog={onLog} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(screen.getByText("Lower Back"));
    expect(onLog).toHaveBeenCalledWith(0.5, 0.46, "back", "Lower Back");
    expect(screen.getByText("Logged · Lower Back")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Left Knee"));
    expect(onLog).toHaveBeenCalledTimes(1);
  });

  it("the map is still the default, and a pattern names its region when one was picked", () => {
    render(<PointAtItScreen patterns={[{ ...PATTERN[0]!, region: "Left Knee" }]} onLog={() => {}} onBack={() => {}} />);
    expect(screen.getByRole("button", { name: "Front" })).toBeInTheDocument();
    expect(screen.getByText("Left Knee, 3 Sessions")).toBeInTheDocument();
  });
});

// 2026-09-14: the details after the tap, and Done with none picked.
describe("PointAtItScreen: how it feels", () => {
  it("offers the details only with the seam, saves the words picked, and Done needs nothing", () => {
    const onDetail = vi.fn();
    render(<PointAtItScreen patterns={[]} onLog={() => {}} onDetail={onDetail} onBack={() => {}} />);
    fireEvent.click(screen.getByText("List"));
    fireEvent.click(screen.getByText("Lower Back"));
    expect(screen.getByText("Done")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Stiffness"));
    fireEvent.click(screen.getByText("Mild"));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "After deadlifts" } });
    fireEvent.click(screen.getByText("Save Details"));
    expect(onDetail).toHaveBeenCalledWith({ feel: "stiffness", level: "mild", note: "After deadlifts" });
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
});
