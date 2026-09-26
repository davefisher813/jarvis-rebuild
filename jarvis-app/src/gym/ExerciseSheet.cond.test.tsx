// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ExerciseSheet from "./ExerciseSheet";

// THE CLOCK ON THE SHEET (2026-09-02). A format turns the strip into a
// clock: the kind follows the format, the strip goes away, the cap is
// built from the parts. Since Fewer Buttons (2026-09-02) the format is
// picked from the Clock row's menu, not a chip row.
const pickClock = (label: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Clock" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
};
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));

describe("ExerciseSheet, the clock", () => {
  it("AMRAP: scores rounds, hides the strip and the Measure row, saves a 12:00 window", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Exercise Name"), { target: { value: "Cindy" } });
    expect(screen.getByText("Measure")).toBeInTheDocument();
    expect(screen.getAllByText("Sets").length).toBeGreaterThan(0);
    pickClock("AMRAP");
    expect(screen.queryByText("Measure")).toBeNull();
    expect(screen.queryAllByText("Sets")).toHaveLength(0);
    // The Clock menu names the format; the line under it carries the length.
    expect(screen.getByText("12:00")).toBeInTheDocument();
    save();
    expect(onSave).toHaveBeenCalledTimes(1);
    const d = onSave.mock.calls[0]![0];
    expect(d.kind).toBe("rounds");
    expect(d.sets).toEqual([]);
    expect(d.cond).toEqual({ format: "amrap", capSec: 720 });
  });
  it("Tabata: eight rounds of 0:20 / 0:10 make a 4:00 cap", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Exercise Name"), { target: { value: "Bike" } });
    pickClock("Tabata");
    expect(screen.getByText("8 × 0:20 / 0:10")).toBeInTheDocument();
    save();
    expect(onSave.mock.calls[0]![0].cond).toEqual({ format: "tabata", capSec: 240, intervalSec: 20, restSec: 10, rounds: 8 });
  });
  it("For Time: scores time in seconds", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Exercise Name"), { target: { value: "Fran" } });
    pickClock("For Time");
    save();
    const d = onSave.mock.calls[0]![0];
    expect(d.kind).toBe("time_faster");
    expect(d.unit).toBe("sec");
    expect(d.cond).toEqual({ format: "for_time", capSec: 720 });
  });
});

// THE GROUPED TABLE (Fewer Buttons, Dave 2026-09-02: "way too many pills";
// picked "iOS grouped rows, value on the right"; "Add a little color").
describe("ExerciseSheet, the grouped table", () => {
  it("wears the sheet bar, four groups, a coloured tile per row, and no chip rows", () => {
    const onSave = vi.fn(), onCancel = vi.fn();
    const { baseElement } = render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={onCancel} />);
    expect(baseElement.querySelector(".sheet-bar .sheet-bar-title")).toHaveTextContent("New Exercise");
    expect(baseElement.querySelector(".sheet-bar-cancel")).toHaveTextContent("Cancel");
    expect([...baseElement.querySelectorAll(".xs-grp .eyebrow")].map((e) => e.textContent)).toEqual(["Name", "Sets", "Tracks", "In the Session", "Note"]);
    expect(baseElement.querySelector(".chip-row")).toBeNull();
    expect(baseElement.querySelectorAll(".chip")).toHaveLength(0);
    // The tiles: one hue per row, the glyph names the row.
    const tiles = [...baseElement.querySelectorAll(".row-ico")].map((t) => t.className.replace("row-ico ", ""));
    // 2026-09-14: Equipment left Tracks for the Sets group, beside the
    // Weight row it defines, so Tracks is Measure, Clock, Muscle again and
    // the second orange tile is gone with it.
    expect(tiles).toEqual(["nav-tile-orange", "nav-tile-blue", "nav-tile-green", "nav-tile-pink", "nav-tile-teal", "nav-tile-yellow", "nav-tile-purple", "nav-tile-graphite"]);
    // Every value that opens a menu is the dropdown worn as a row value.
    // Equipment and Counted As now read in the order you meet them: above
    // Weight, above Unit, and well above Measure.
    // AMENDED 2026-09-16 (Dave: "you cannot tell me the module that renders
    // when you click on an exercise has everything you need... I still don't
    // see enough options with various weight loading"). Reps Count joins them,
    // beside the reading it completes: Counted As says what the WEIGHT is,
    // Reps Count says whether 8 is 8 or 8 a side. It is a value and not a
    // toggle for the same reason every row here is -- a switch cannot say
    // which way is on without a line of grey under it.
    expect([...baseElement.querySelectorAll(".dd.dd-value")].map((d) => d.getAttribute("aria-label"))).toEqual(["Equipment", "Reps count", "Unit", "Measure", "Clock", "Muscle", "Rest Timer"]);
    fireEvent.click(baseElement.querySelector(".sheet-bar-cancel")!);
    expect(onCancel).toHaveBeenCalled();
  });

  it("the Measure row's menu regenerates the strip for the new kind; Muscle and Filler save", () => {
    const onSave = vi.fn();
    render(<ExerciseSheet mode="new" library={[]} history={[]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Exercise Name"), { target: { value: "Plank" } });
    fireEvent.click(screen.getByRole("button", { name: "Measure" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Time, longer is better" }));
    fireEvent.click(screen.getByRole("button", { name: "Muscle" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Core" }));
    fireEvent.click(screen.getByRole("switch", { name: "Filler" }));
    save();
    const d = onSave.mock.calls[0]![0];
    expect(d.kind).toBe("time_longer");
    expect(d.muscleGroup).toBe("core");
    expect(d.filler).toBe(true);
    expect(d.sets).toHaveLength(3);
  });

  it("Save without a name surfaces the error instead of saving; Delete sits at the bottom and arms first", () => {
    const onSave = vi.fn(), onDelete = vi.fn();
    const { baseElement } = render(<ExerciseSheet mode="edit" initial={{ id: "x", name: "Bench", kind: "weight_reps", unit: "lb", sets: [] }} library={[]} history={[]} onSave={onSave} onDelete={onDelete} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Exercise Name"), { target: { value: "" } });
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
    const del = baseElement.querySelector(".xs-delete .btn")!;
    expect(del).toHaveTextContent("Delete Exercise");
    expect(baseElement.querySelector(".sheet-form")!.lastElementChild).toHaveClass("xs-delete");
    fireEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Tap Again to Confirm"));
    expect(onDelete).toHaveBeenCalled();
  });
});
