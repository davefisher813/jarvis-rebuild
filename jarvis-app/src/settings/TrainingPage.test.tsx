// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import TrainingPage, { rackForUnit, platesToShow, PLATE_SETS } from "./TrainingPage";
import { readGymSettings, writeGymSettings } from "../gym/settings";

// S5-Q32 (2026-09-04): "bar weight and plates have no control." Every plate
// calculation read a stored barWeight/plates that nothing in the app could
// ever set, so every gym was stuck on the 45 lb imperial default. The store,
// the six readers and the rackFrom fallback were already built and fully
// tested (gym/settings.test.ts) -- this only tests the controls that finally
// write through them.
describe("TrainingPage: bar weight and plates (S5-Q32)", () => {
  beforeEach(() => { localStorage.clear(); });

  it("shows the stored bar weight and writes a change through the real store", async () => {
    render(<TrainingPage onBack={() => {}} />);
    const input = screen.getByLabelText("Bar Weight") as HTMLInputElement;
    expect(input.value).toBe("45");
    fireEvent.change(input, { target: { value: "20" } });
    await waitFor(() => expect(readGymSettings().barWeight).toBe(20));
  });

  it("a blank mid-edit never reaches the store, and the field snaps back on blur", () => {
    render(<TrainingPage onBack={() => {}} />);
    const input = screen.getByLabelText("Bar Weight") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(readGymSettings().barWeight).toBe(45);
    fireEvent.blur(input);
    expect(input.value).toBe("45");
  });

  it("the default rack's plates start selected, and unselecting one writes through", async () => {
    render(<TrainingPage onBack={() => {}} />);
    const chip45 = screen.getByText("45", { selector: ".chip" });
    expect(chip45).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip45);
    await waitFor(() => expect(readGymSettings().plates).not.toContain(45));
    fireEvent.click(chip45);
    await waitFor(() => expect(readGymSettings().plates).toContain(45));
  });

  it("a plate the default rack lacks starts unselected and can be added to the rack; the Lb strip does not offer a metric 20", async () => {
    render(<TrainingPage onBack={() => {}} />);
    // Each unit shows its own standard set (2026-10-05): a 20 is a Kg plate.
    expect(screen.queryByText("20", { selector: ".chip" })).toBeNull();
    const chip15 = screen.getByText("15", { selector: ".chip" });
    expect(chip15).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip15);
    await waitFor(() => expect(readGymSettings().plates).toContain(15));
  });

  it("on a fresh rack the Kg strip starts with the whole kilo set on it", () => {
    render(<TrainingPage onBack={() => {}} />);
    fireEvent.click(screen.getByText("Kg", { selector: ".seg" }));
    for (const p of PLATE_SETS.kg) expect(screen.getByText(String(p), { selector: ".chip" }), String(p)).toHaveAttribute("aria-pressed", "true");
  });
});

// AUDIT 2026-09-29 read the rack hint as "Inkg." / "Inlb." (no space). The
// source has a space (it is JSX text plus an interpolation, which a reader
// that joins text nodes without separators can garble). Not a bug in the app;
// this pins the sentence a person is shown.
describe("TrainingPage: the unit hint", () => {
  beforeEach(() => { localStorage.clear(); });

  it("is one plain sentence, whichever unit, with no dot typed in it and no unit jammed into it", () => {
    render(<TrainingPage onBack={() => {}} />);
    const hint = () => document.querySelector(".input-hint")!;
    expect(hint().textContent).toBe("A lift logged in the other unit is converted both ways");
    fireEvent.click(screen.getByText("Kg", { selector: ".seg" }));
    expect(hint().textContent).toBe("A lift logged in the other unit is converted both ways");
    expect(hint().textContent).not.toContain("\u00b7");
  });
});

// 2026-10-04 (audit): a rack tap wrote back the gym blob as it was when the
// page mounted, so whatever another control had saved since was rolled back.
describe("TrainingPage: a rack tap lands on what is stored now", () => {
  beforeEach(() => { localStorage.clear(); });

  it("keeps a value saved elsewhere after the page mounted", async () => {
    render(<TrainingPage onBack={() => {}} />);
    writeGymSettings({ ...readGymSettings(), showLast: false, hiddenKeys: ["bench"] });
    fireEvent.click(screen.getByText("5", { selector: ".chip" }));
    await waitFor(() => expect(readGymSettings().plates).not.toContain(5));
    expect(readGymSettings().showLast).toBe(false);
    expect(readGymSettings().hiddenKeys).toEqual(["bench"]);
  });
});

// THE RACK UNIT, WHOLE, AND THE RACK THAT FOLLOWS IT (2026-10-05, the review: the Lb/Kg strip scrolled and clipped its right half; with Kg
// picked the bar still read a unitless 45 and the plates were a pound set).
describe("TrainingPage: Rack Unit is a whole segmented control and the rack follows it", () => {
  beforeEach(() => { localStorage.clear(); });

  it("draws Lb and Kg as two segments, not a scrolling chip strip that clips its edge", () => {
    const { container } = render(<TrainingPage onBack={() => {}} />);
    const group = screen.getByRole("group", { name: "Rack Unit" });
    expect(group).toHaveClass("segmented");
    expect(group.closest(".chip-row"), "no scroller (overflow-x, a fade mask) around the units").toBeNull();
    expect([...group.querySelectorAll(".seg")].map((b) => b.textContent)).toEqual(["Lb", "Kg"]);
    expect(group.querySelector(".seg.active")!.textContent).toBe("Lb");
    // Only the plate strip is a chip strip now.
    expect(container.querySelectorAll(".chip-row").length).toBe(1);
  });

  it("Kg turns the 45 bar into a 20, swaps the plates for the kilo set, and says the unit beside the number", async () => {
    render(<TrainingPage onBack={() => {}} />);
    expect((screen.getByLabelText("Bar Weight") as HTMLInputElement).value).toBe("45");
    expect(document.querySelector(".set-unit")!.textContent).toBe("Lb");
    fireEvent.click(screen.getByText("Kg", { selector: ".seg" }));
    await waitFor(() => expect(readGymSettings()).toMatchObject({ rackUnit: "kg", barWeight: 20 }));
    expect((screen.getByLabelText("Bar Weight") as HTMLInputElement).value).toBe("20");
    expect(document.querySelector(".set-unit")!.textContent).toBe("Kg");
    const shown = [...document.querySelectorAll(".chip-row .chip")].map((c) => Number(c.textContent));
    expect(shown).toEqual([...PLATE_SETS.kg].sort((a, b) => b - a));
    expect(shown).not.toContain(45);
    // and back
    fireEvent.click(screen.getByText("Lb", { selector: ".seg" }));
    await waitFor(() => expect(readGymSettings()).toMatchObject({ rackUnit: "lb", barWeight: 45 }));
  });

  it("a bar or plate list the person set themselves is kept when the unit changes", () => {
    const own = rackForUnit({ rackUnit: "lb", barWeight: 35, plates: [45, 25, 10] }, "kg");
    expect(own).toEqual({ rackUnit: "kg", barWeight: 35, plates: [45, 25, 10] });
    // a plate already on the rack that the new unit's set does not list stays on the strip
    expect(platesToShow("kg", [45, 25])).toContain(45);
    // the same unit changes nothing
    expect(rackForUnit({ rackUnit: "kg", barWeight: 20, plates: [25, 20] }, "kg")).toEqual({ rackUnit: "kg", barWeight: 20, plates: [25, 20] });
  });
});
