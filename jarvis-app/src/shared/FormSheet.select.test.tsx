// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FieldRow } from "./FormSheet";

// Dave 2026-10-17: "Even the cursor functionality. It matters." The Set
// sheet's weight field put the caret after 310, so typing 5 gave 5310. A
// numeric field selects its value on focus, and the row's own tap does too.
describe("FieldRow selects a number on focus", () => {
  it("selects on focus for a numeric or decimal keypad, and when the row is tapped", () => {
    render(<FieldRow label="Weight" value="310" onChange={() => {}} inputMode="decimal" ariaLabel="Set 1 weight" />);
    const input = screen.getByLabelText("Set 1 weight") as HTMLInputElement;
    const select = vi.spyOn(input, "select");
    fireEvent.focus(input);
    expect(select).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Weight"));
    expect(select.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("leaves a text field's caret alone", () => {
    render(<FieldRow label="Name" value="Bench Press" onChange={() => {}} ariaLabel="Exercise name" />);
    const input = screen.getByLabelText("Exercise name") as HTMLInputElement;
    const select = vi.spyOn(input, "select");
    fireEvent.focus(input);
    expect(select).not.toHaveBeenCalled();
  });
});
