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

// ---------------------------------------------------------------------------
// TWO DEFECTS DAVE PHOTOGRAPHED MID-SET, 2026-09-16, both on one chip.
//
// "When you log something, it automatically adds a set. That's not correct."
// A 550ms press on a chip duplicated it. That is a thumb resting on a phone
// between sets, and it inserted a set silently, with no toast and no undo.
// GYM-F-26 settled the same argument on the gym's other rows in September: a
// long press that is the only door to an action is a door nothing announces
// and no keyboard or VoiceOver user can open.
//
// "I don't even know what I'm logging." The editor opens UNDER the chip, and
// once the steppers and the How Did It Move chips are on screen the chip has
// gone past the fold, so the panel was a set of controls belonging to nothing
// visible.
// ---------------------------------------------------------------------------
describe("SetStrip: the chip's editor", () => {
  const entries = [{ id: "s1", w: 185, r: 5 }, { id: "s2", w: 185, r: 5 }];

  it("says which set it is editing", () => {
    render(<SetStrip kind="weight_reps" unit="lb" entries={entries} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Set 2, 185 lb × 5, tap to edit"));
    expect(screen.getByText("Editing Set 2")).toBeInTheDocument();
  });

  it("holding a chip adds nothing at all", () => {
    const onChange = vi.fn();
    render(<SetStrip kind="weight_reps" unit="lb" entries={entries} onChange={onChange} />);
    const chip = screen.getByLabelText("Set 1, 185 lb × 5, tap to edit");
    fireEvent.pointerDown(chip);
    return new Promise<void>((done) => {
      setTimeout(() => {
        expect(onChange).not.toHaveBeenCalled();
        done();
      }, 700);
    });
  });

  it("and Duplicate is a row in the editor instead, where it can be seen and typed at", () => {
    const onChange = vi.fn();
    render(<SetStrip kind="weight_reps" unit="lb" entries={entries} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Set 1, 185 lb × 5, tap to edit"));
    fireEvent.click(screen.getByText("Duplicate This Set"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toHaveLength(3);
  });
});
