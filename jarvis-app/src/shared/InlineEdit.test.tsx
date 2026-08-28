// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import InlineEdit from "./InlineEdit";

describe("InlineEdit", () => {
  it("syncs the DOM to a new value when nobody is in the field", () => {
    const { rerender } = render(<InlineEdit value="Gym" onSave={() => {}} />);
    expect(screen.getByText("Gym")).toBeInTheDocument();
    rerender(<InlineEdit value="Deep Work" onSave={() => {}} />);
    expect(screen.getByText("Deep Work")).toBeInTheDocument();
  });

  it("never overwrites what is being actively typed, even when a background reload lands mid-keystroke", () => {
    // THE BUG (2026-08-28, Dave: "extremely difficult to type"). NotesFlow
    // saves a block on blur, then reloads the whole note; that reload can
    // land while the person has already moved into the NEXT field and is
    // typing. The old sync effect only checked "does the DOM disagree with
    // the incoming value" - which is true on every keystroke by definition -
    // and stomped the field with the stale pre-edit text, mid-word.
    const { container } = render(<InlineEdit value="Lunch" onSave={() => {}} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    el.focus();
    // Simulate the user typing, uncontrolled (no React state change - this
    // is exactly how the real contentEditable behaves).
    el.textContent = "Lunch with the team";
    // A background reload resolves and hands this same block its OLD,
    // pre-edit value as a fresh prop - the value prop the user's in-progress
    // typing has already diverged from.
    render(<InlineEdit value="Lunch" onSave={() => {}} />, { container: container as unknown as HTMLElement });
    expect(el.textContent).toBe("Lunch with the team");
  });

  it("still syncs the same element once it is no longer focused", () => {
    const { container } = render(<InlineEdit value="Lunch" onSave={() => {}} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    el.focus();
    el.textContent = "Lunch with the team";
    el.blur();
    render(<InlineEdit value="Dinner" onSave={() => {}} />, { container: container as unknown as HTMLElement });
    expect(el.textContent).toBe("Dinner");
  });

  it("blur still saves whatever is in the field", () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEdit value="Gym" onSave={onSave} />);
    const el = container.querySelector("[contenteditable]") as HTMLElement;
    el.textContent = "Morning Gym";
    fireEvent.blur(el);
    expect(onSave).toHaveBeenCalledWith("Morning Gym");
  });
});
