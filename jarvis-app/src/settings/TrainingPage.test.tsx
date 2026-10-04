// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import TrainingPage from "./TrainingPage";
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

  it("a metric-only plate starts unselected and can be added to the rack", async () => {
    render(<TrainingPage onBack={() => {}} />);
    const chip20 = screen.getByText("20", { selector: ".chip" });
    expect(chip20).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip20);
    await waitFor(() => expect(readGymSettings().plates).toContain(20));
  });
});

// AUDIT 2026-09-29 read the rack hint as "Inkg." / "Inlb." (no space). The
// source has a space (it is JSX text plus an interpolation, which a reader
// that joins text nodes without separators can garble). Not a bug in the app;
// this pins the sentence a person is shown.
describe("TrainingPage: the unit hint", () => {
  beforeEach(() => { localStorage.clear(); });

  it("reads 'In lb.' and 'In kg.' with the space, as one piece of text", () => {
    render(<TrainingPage onBack={() => {}} />);
    const hint = () => document.querySelector(".input-hint")!;
    expect(hint().textContent).toMatch(/^In lb\. A lift logged/);
    fireEvent.click(screen.getByText("kg", { selector: ".chip" }));
    expect(hint().textContent).toMatch(/^In kg\. A lift logged/);
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
