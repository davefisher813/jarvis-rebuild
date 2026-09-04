// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReminderSheet from "./ReminderSheet";

// The reminder sheet on the sheet bar (2026-09-02): the name as the row, the
// time at the right with the quick hours under it, Repeat and If You Miss
// It as menus. Two taps is still the whole form.
describe("ReminderSheet", () => {
  it("needs a name; a quick hour and the Weekdays preset land in the save", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.click(screen.getByText("9 PM"));
    fireEvent.click(screen.getByLabelText("Repeat"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Weekdays" }));
    fireEvent.click(screen.getByLabelText("If you miss it"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Let It Go" }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith("Meds", { time: "21:00", days: [1, 2, 3, 4, 5], onMiss: "let_go" });
  });

  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save used to
  // fire onSave every tap, so a fast double-tap wrote the reminder twice.
  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("edit mode prefills, reads the preset back, and offers the calendar and delete rows", () => {
    const onDelete = vi.fn();
    const onAddToCalendar = vi.fn();
    render(<ReminderSheet mode="edit" initial={{ text: "Stretch", reminder: { time: "07:00", days: [0, 6], doneCount: 3 } }}
      onSave={() => {}} onDelete={onDelete} onAddToCalendar={onAddToCalendar} onCancel={() => {}} />);
    expect((screen.getByLabelText("Reminder") as HTMLInputElement).value).toBe("Stretch");
    expect(screen.getByLabelText("Repeat").textContent).toContain("Weekends");
    fireEvent.click(screen.getByText("Add to iPhone Calendar"));
    expect(onAddToCalendar).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete Reminder"));
    expect(onDelete).toHaveBeenCalled();
  });
});
