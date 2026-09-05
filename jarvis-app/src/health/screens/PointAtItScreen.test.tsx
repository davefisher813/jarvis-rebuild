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
