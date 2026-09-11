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
    // A DAY AND AN AREA RIDE ALONG NOW (Dave 2026-09-11: "I can't even select
    // a date for a reminder. Expand the booking options"). A reminder is a
    // task carrying a ReminderInfo, and this sheet only ever wrote the
    // reminder half; the task's own due and category come through as `extra`.
    expect(onSave).toHaveBeenCalledWith("Meds", { time: "21:00", days: [1, 2, 3, 4, 5], onMiss: "let_go" },
      { due: null, category: "" });
  });

  it("takes a day, and a day with no rhythm reads as Just Once", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Call the pharmacy" } });
    fireEvent.click(screen.getByText("Tomorrow"));
    expect(screen.getByLabelText("Repeat").textContent).toContain("Just Once");
    fireEvent.click(screen.getByText("Save"));
    const [, r, extra] = onSave.mock.calls[0]!;
    expect(extra.due, "the day is written to the task's own due").toBeTruthy();
    expect(r.days, "Just Once stores no day pattern, which is what once means").toBeUndefined();
  });

  it("files to an area when the caller has areas to offer, and shows no row when it does not", () => {
    const onSave = vi.fn();
    const { rerender } = render(<ReminderSheet onSave={onSave} onCancel={() => {}} />);
    expect(screen.queryByLabelText("Area")).toBeNull();
    rerender(<ReminderSheet onSave={onSave} onCancel={() => {}} categories={[{ id: "c1", name: "Health", color: "green" }]} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.click(screen.getByLabelText("Area"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Health/ }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![2].category).toBe("c1");
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
