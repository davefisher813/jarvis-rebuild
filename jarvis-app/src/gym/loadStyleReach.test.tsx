// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SetStrip from "./SetStrip";
import LoadSheet from "./LoadSheet";
import { fieldsFor, formatSet } from "./measures";
import { loadStyleOf, repLabel, sideSuffix, volumeFactor } from "./equipment";
import { classOf, styleOf } from "./classify";

// ---------------------------------------------------------------------------
// DAVE, 2026-09-16, four photographs of a live set:
//
//   "I don't even have the option while I'm logging to select what type of
//    weight system it is essentially. So it just always defaults to dumbbell
//    weight, so the plate loading and all that is completely off if I'm not
//    doing that. And then if I'm using dumbbells, it doesn't adjust for
//    dumbbells... If it's a bilateral exercise versus unilateral, that should
//    change things. So if it's unilateral, it should be amount of reps on
//    each side."
//
// Three separate holes, and the first one is the one that made the other two
// invisible: equipment.ts has known since it was written that a stack steps
// in 10s and an assisted machine records help rather than load, and the SET
// STRIP -- the thing an athlete types into mid-set -- called fieldsFor(kind)
// with no equipment at all.
// ---------------------------------------------------------------------------
describe("the strip adjusts to what the lift loads with", () => {
  it("steps the weight field by the equipment, not by 5 for everything", () => {
    const onChange = vi.fn();
    render(<SetStrip kind="weight_reps" unit="lb" style={{ equipment: "stack", counted: "total" }}
      entries={[{ id: "s1", w: 100, r: 10 }]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Set 1, 100 lb × 10, tap to edit"));
    fireEvent.click(screen.getByLabelText("More Weight"));
    // A selectorized stack moves in 10s. The old strip offered 5 for
    // everything in the gym, so this landed on a pin that does not exist.
    expect(onChange.mock.calls[0]![0][0]).toMatchObject({ w: 110 });
  });

  it("says Assistance on an assist machine, where the number is help and not load", () => {
    render(<SetStrip kind="weight_reps" unit="lb" style={{ equipment: "assisted", counted: "assist" }}
      entries={[{ id: "s1", w: 60, r: 8 }]} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Set 1, 60 lb × 8, tap to edit"));
    expect(screen.getByText("Assistance")).toBeInTheDocument();
    expect(screen.queryByText("Weight")).toBeNull();
  });

  // A dumbbell press and a cable row are both weight_reps, and both were
  // being told which plates to hang on a barbell -- with the rack's 45 lb bar
  // subtracted first, which is a bar neither of them has.
  it("offers plate math only where plates go on, and takes no bar off a machine", () => {
    const { unmount } = render(<SetStrip kind="weight_reps" unit="lb" style={{ equipment: "dumbbell", counted: "each_hand" }}
      entries={[{ id: "s1", w: 50, r: 10 }]} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Set 1, 50 lb × 10, tap to edit"));
    expect(screen.queryByText("Per Side")).toBeNull();
    unmount();

    render(<SetStrip kind="weight_reps" unit="lb" style={{ equipment: "machine", counted: "total" }}
      entries={[{ id: "s2", w: 90, r: 10 }]} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Set 1, 90 lb × 10, tap to edit"));
    // 90 with no bar is 45 a side. A barbell reading would say 22.5.
    expect(screen.getByText("Per Side")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// THE REPS AXIS. `counted` says what the WEIGHT means and always has. This is
// the other half and it is about the reps: on a Bulgarian split squat, 8 is 8
// per leg and the set is 16. A LABEL, never a conversion -- nothing doubles
// the number the athlete typed. What it changes is what the field is called,
// what the chip reads, and what tonnage counts.
// ---------------------------------------------------------------------------
describe("one side at a time", () => {
  it("is its own axis, not a third reading of the weight", () => {
    // A dumbbell bench press: each hand, both arms at once.
    expect(loadStyleOf({ equipment: "dumbbell" }).sided).toBeUndefined();
    // A single-arm cable row: the whole stack, one side at a time.
    const arm = loadStyleOf({ equipment: "cable", counted: "total", sided: true });
    expect(arm.counted).toBe("total");
    expect(arm.sided).toBe(true);
  });

  it("names the reps field and the chip after it", () => {
    expect(repLabel({ sided: true })).toBe("Reps Per Side");
    expect(repLabel({})).toBe("Reps");
    expect(fieldsFor("weight_reps", { equipment: "dumbbell", counted: "each_hand", sided: true, unit: "lb" })[0]!.label)
      .toBe("Reps Per Side");
    expect(formatSet({ kind: "weight_reps", unit: "lb", sided: true }, { w: 50, r: 8 })).toBe("50 lb × 8 per side");
    expect(formatSet({ kind: "weight_reps", unit: "lb" }, { w: 50, r: 8 })).toBe("50 lb × 8");
  });

  it("doubles the reps for tonnage, and multiplies with the weight's own factor", () => {
    expect(volumeFactor({ sided: true })).toBe(2);
    // A dumbbell split squat is both: two bells AND two legs.
    expect(volumeFactor({ equipment: "dumbbell", counted: "each_hand", sided: true })).toBe(4);
    expect(volumeFactor({ equipment: "dumbbell", counted: "each_hand" })).toBe(2);
    // Assistance is still the honest zero whatever the reps do.
    expect(volumeFactor({ equipment: "assisted", counted: "assist", sided: true })).toBe(0);
  });

  it("never touches the number that was typed", () => {
    expect(sideSuffix({ sided: true })).toBe(" per side");
    // The suffix is the whole of it: the reading changes, the datum does not.
    expect(formatSet({ kind: "reps", sided: true }, { r: 12 })).toBe("12 reps per side");
  });
});

// ---------------------------------------------------------------------------
// AND ALL THREE ANSWERS ARE REACHABLE FROM THE RACK. ClassifySheet asks the
// same questions, but it is a library editor: eight groups, a muscle grid and
// a scope question that rewrites an exercise's whole history. That is the
// right sheet for a quiet evening and the wrong one between sets.
// ---------------------------------------------------------------------------
describe("LoadSheet", () => {
  it("asks the three questions and hands back one style", () => {
    const onSave = vi.fn();
    render(<LoadSheet name="Bulgarian Split Squat" initial={{}} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText("Equipment Dumbbells"));
    // AMENDED 2026-09-16: the toggle became a value row, because a toggle
    // needs a sentence under it to say which way is on and that sentence is
    // exactly what Dave asked to be gone.
    fireEvent.click(screen.getByLabelText("Reps count"));
    fireEvent.click(screen.getByText("Per Side"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ equipment: "dumbbell", counted: undefined, sided: true });
  });

  it("drops a reading the new equipment does not offer", () => {
    const onSave = vi.fn();
    render(<LoadSheet name="Row" initial={{ equipment: "dumbbell", counted: "each_hand" }} onSave={onSave} onCancel={() => {}} />);
    // A weight stack has exactly one reading, so it asks nothing -- and
    // "Each Hand" on it is not an answer, it is a leftover.
    fireEvent.click(screen.getByLabelText("Equipment Selectorized Machine"));
    expect(screen.queryByLabelText("Counted as Each Hand")).toBeNull();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ equipment: "stack", counted: undefined });
  });
});

// The library's word for the same fact. Execution has said Unilateral since
// the classification shipped and nothing downstream read it, so a lift could
// be marked Unilateral in the library and log bilateral reps in the gym.
describe("Execution and sided are one fact", () => {
  it("unilateral means one side at a time, and alternating does not", () => {
    expect(styleOf({ primary: [], secondary: [], tags: [], execution: "unilateral" }).sided).toBe(true);
    // Alternating trades sides WITHIN the set, so its rep count already
    // spans both and doubling it would be a lie.
    expect(styleOf({ primary: [], secondary: [], tags: [], execution: "alternating" }).sided).toBeUndefined();
    expect(styleOf({ primary: [], secondary: [], tags: [], execution: "bilateral" }).sided).toBeUndefined();
  });

  it("a sighting that says sided fills in an Execution nobody set, and never overwrites one", () => {
    const store = {};
    expect(classOf(store, { key: "k" }, { sided: true }).execution).toBe("unilateral");
    expect(classOf({ k: { primary: [], secondary: [], tags: [], execution: "bilateral" as const } },
      { key: "k" }, { sided: true }).execution).toBe("bilateral");
  });
});
