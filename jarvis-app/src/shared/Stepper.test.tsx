// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import Stepper from "./Stepper";

// Stepper became the sixth law-protected primitive on 2026-08-23 and had no
// tests of its own. The gym module, its only consumer, has no component tests
// at all, so the promotion and everything added with it (min/max clamping,
// disabled ends, labels) shipped on tsc and eyeballs. Not any more.

const setup = (over: Partial<Parameters<typeof Stepper>[0]> = {}) => {
  const onChange = vi.fn();
  const utils = render(<Stepper value={10} step={5} onChange={onChange} {...over} />);
  return { onChange, ...utils };
};

describe("nudging", () => {
  it("steps up and down by the step", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText("More"));
    expect(onChange).toHaveBeenCalledWith(15);
    fireEvent.click(screen.getByLabelText("Less"));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("does not accumulate floating point dust", () => {
    const { onChange } = setup({ value: 0.1, step: 0.2 });
    fireEvent.click(screen.getByLabelText("More"));
    expect(onChange).toHaveBeenCalledWith(0.3); // not 0.30000000000000004
  });

  it("names the value so several steppers in one card are distinguishable", () => {
    setup({ label: "Reps" });
    expect(screen.getByLabelText("More Reps")).toBeInTheDocument();
    expect(screen.getByLabelText("Less Reps")).toBeInTheDocument();
  });
});

describe("the ends", () => {
  it("will not go below the floor, and says so", () => {
    const { onChange } = setup({ value: 1, step: 1, min: 1 });
    const less = screen.getByLabelText("Less");
    expect(less).toBeDisabled();
    fireEvent.click(less);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clamps rather than refusing when a step would overshoot the floor", () => {
    const { onChange } = setup({ value: 2, step: 5, min: 0 });
    fireEvent.click(screen.getByLabelText("Less"));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("has no ceiling unless one is given", () => {
    const { onChange } = setup({ value: 999, step: 1 });
    expect(screen.getByLabelText("More")).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText("More"));
    expect(onChange).toHaveBeenCalledWith(1000);
  });

  it("respects a ceiling when one is given", () => {
    const { onChange } = setup({ value: 60, step: 15, max: 60 });
    expect(screen.getByLabelText("More")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("More"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// The whole reason this component exists rather than the stripped copy that
// was in SessionScreen: 0 to 185 is one tap and three digits, not 37 taps.
describe("tap the number to type it", () => {
  it("turns the readout into an input and commits what you type", () => {
    const { onChange, container } = setup({ value: 0, step: 5 });
    fireEvent.click(screen.getByText("0"));
    const input = container.querySelector(".stepper-edit") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "185" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(185);
  });

  it("commits on Enter too", () => {
    const { onChange, container } = setup({ value: 0, step: 5 });
    fireEvent.click(screen.getByText("0"));
    const input = container.querySelector(".stepper-edit") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("refuses characters that are not a number", () => {
    const { container } = setup({ value: 0, step: 5 });
    fireEvent.click(screen.getByText("0"));
    const input = container.querySelector(".stepper-edit") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1a2b.5" } });
    expect(input.value).toBe("12.5");
  });

  it("clamps a typed value to the range instead of taking it", () => {
    const { onChange, container } = setup({ value: 5, step: 1, min: 1, max: 10 });
    fireEvent.click(screen.getByText("5"));
    const input = container.querySelector(".stepper-edit") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "900" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("leaves the value alone when the field is emptied and dismissed", () => {
    const { onChange, container } = setup({ value: 5, step: 1, min: 1 });
    fireEvent.click(screen.getByText("5"));
    const input = container.querySelector(".stepper-edit") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    // Empty is not zero and not a number; the readout comes back untouched.
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it("is reachable from the keyboard, not only by tap", () => {
    const { container } = setup({ value: 7, step: 1 });
    fireEvent.keyDown(screen.getByText("7"), { key: "Enter" });
    expect(container.querySelector(".stepper-edit")).toBeTruthy();
  });
});
