// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SetStrip from "./SetStrip";

// 2026-10-17 (defects A, B, C, E): the Now card's grid was weight_reps only,
// its fields said Set 1 whatever set it was on, and the planned rows under it
// were dead taps.
describe("SetStrip: one grid for every kind", () => {
  it("a reps lift gets a reps field that reports what is typed", () => {
    const onNowDraft = vi.fn();
    render(<SetStrip kind="reps" entries={[]} onChange={() => {}} ghost={[{ id: "g1", r: 10 }]} editableGhosts onNowDraft={onNowDraft} />);
    const reps = screen.getByLabelText("Set 1 Reps");
    expect(reps).toHaveValue(10);
    fireEvent.change(reps, { target: { value: "12" } });
    expect(onNowDraft).toHaveBeenLastCalledWith({ w: "", r: "12" });
  });

  it("a timed lift gets a time field in its unit; a distance and time attempt gets both", () => {
    const onNowDraft = vi.fn();
    render(<SetStrip kind="time_longer" unit="sec" entries={[]} onChange={() => {}} ghost={[{ id: "g1", v: 60 }]} editableGhosts onNowDraft={onNowDraft} />);
    const time = screen.getByLabelText("Set 1 Time");
    expect(time).toHaveValue(60);
    expect(time).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(time, { target: { value: "75" } });
    expect(onNowDraft).toHaveBeenLastCalledWith({ w: "", r: "", v: "75" });
  });

  it("a distance and time attempt gets both fields", () => {
    render(<SetStrip kind="distance_time" unit="mi" timeUnit="min" entries={[]} onChange={() => {}} ghost={[{ id: "g2", v: 1, t: 7 }]} editableGhosts />);
    expect(screen.getByLabelText("Set 1 Distance")).toHaveValue(1);
    expect(screen.getByLabelText("Set 1 Time")).toHaveValue(7);
    expect(screen.getByText("Min", { selector: ".se-grid-u" })).toBeInTheDocument();
  });

  it("a done mark has no field", () => {
    render(<SetStrip kind="done" entries={[]} onChange={() => {}} ghost={[{ id: "g1" }]} editableGhosts />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByText("Mark Done")).toBeInTheDocument();
  });

  it("the fields are named for the set the session says he is on", () => {
    render(<SetStrip kind="weight_reps" unit="lb" entries={[]} onChange={() => {}} ghost={[{ id: "g1", w: 120, r: 10 }]} editableGhosts nowNo={3} />);
    expect(screen.getByLabelText("Set 3 Weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Set 3 Reps")).toBeInTheDocument();
  });

  it("a planned row opens the editor at its strip position; the Now row does not", () => {
    const onOpenGhost = vi.fn();
    render(<SetStrip kind="weight_reps" unit="lb" entries={[{ id: "s1", w: 120, r: 10 }]} onChange={() => {}} ghost={[{ id: "g1", w: 120, r: 10 }, { id: "g2", w: 120, r: 10 }]} editableGhosts onOpenGhost={onOpenGhost} />);
    const next = screen.getByRole("button", { name: "Set 3, 120 lb × 10, tap to edit" });
    expect(next.className).toContain("se-door");
    fireEvent.click(next);
    expect(onOpenGhost).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByText("Now · Set 2"));
    expect(onOpenGhost).toHaveBeenCalledTimes(1);
  });

  it("without the prop the planned rows are not doors", () => {
    const { container } = render(<SetStrip kind="weight_reps" unit="lb" entries={[]} onChange={() => {}} ghost={[{ id: "g1", w: 120, r: 10 }, { id: "g2", w: 120, r: 10 }]} editableGhosts />);
    expect(container.querySelector(".se-door")).toBeNull();
  });
});
