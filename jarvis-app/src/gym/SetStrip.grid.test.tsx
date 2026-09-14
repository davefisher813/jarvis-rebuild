// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SetStrip from "./SetStrip";

// 2026-09-14 (the reference's set grid): a ghost's two fields and a tick log
// what the fields say; the row body still logs the plan.
describe("SetStrip: editable ghosts", () => {
  it("ticks the edited numbers, and the row body logs the plan as it stands", () => {
    const onLogGhostAs = vi.fn();
    const onLogGhost = vi.fn();
    render(<SetStrip kind="weight_reps" unit="lb" entries={[]} onChange={() => {}} ghost={[{ id: "g1", w: 120, r: 10 }]} editableGhosts onLogGhost={onLogGhost} onLogGhostAs={onLogGhostAs} />);
    fireEvent.change(screen.getByLabelText("Set 1 weight"), { target: { value: "125" } });
    fireEvent.change(screen.getByLabelText("Set 1 reps"), { target: { value: "8" } });
    fireEvent.click(screen.getByLabelText("Log set 1"));
    expect(onLogGhostAs).toHaveBeenCalledWith(0, { w: 125, r: 8 });
    expect(onLogGhost).not.toHaveBeenCalled();
  });
  it("is the plain ghost without the flag, and never on a kind with no weight", () => {
    render(<SetStrip kind="reps" entries={[]} onChange={() => {}} ghost={[{ id: "g1", r: 10 }]} editableGhosts onLogGhostAs={() => {}} />);
    expect(screen.queryByLabelText("Set 1 reps")).toBeNull();
    expect(screen.getByText("10 reps")).toBeInTheDocument();
  });
});
