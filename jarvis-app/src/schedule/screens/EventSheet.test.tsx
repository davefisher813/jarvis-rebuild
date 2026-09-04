// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import EventSheet, { type SheetCategory } from "./EventSheet";

const CATS: SheetCategory[] = [
  { id: "c1", name: "Work", color: "blue" },
  { id: "c2", name: "Friends", color: "teal" },
];

describe("EventSheet", () => {
  it("new mode: header, no delete", () => {
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("New Event")).toBeInTheDocument();
    expect(screen.queryByText("Delete Event")).not.toBeInTheDocument();
  });

  it("blocks save until title present, then saves the draft", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Needs title · Date · Start")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/happening/), { target: { value: "Standup" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ title: "Standup", date: "2026-05-24", start: "09:00", end: "10:00", category: "c1", location: "", recurrence: "none", until: "", taskIds: [], gym: false });
  });

  // The area is a value that opens the dropdown (the form sheets, 2026-09-02):
  // the closed value wears the area's dot, never a filled chip.
  it("the area value wears its dot, opens a menu, and saves the picked id", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    const area = screen.getByLabelText("Area");
    expect(area.querySelector(".cat-dot.cat-bg-blue")).toBeTruthy();
    fireEvent.click(area);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Friends/ }));
    expect(area.querySelector(".cat-dot.cat-bg-teal")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/happening/), { target: { value: "Lunch" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ title: "Lunch", date: "2026-05-24", start: "09:00", end: "10:00", category: "c2", location: "", recurrence: "none", until: "", taskIds: [], gym: false });
  });

  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save used to
  // fire onSave every tap, so a fast double-tap wrote the event twice.
  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/happening/), { target: { value: "Standup" } });
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("edit mode: prefilled, delete fires", () => {
    const onDelete = vi.fn();
    render(
      <EventSheet
        mode="edit"
        initial={{ title: "Client Call", date: "2026-05-26", start: "10:00", category: "c2" }}
        categories={CATS}
        onSave={() => {}}
        onDelete={onDelete}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Edit Event")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Client Call")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-05-26")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delete Event"));
    expect(onDelete).toHaveBeenCalled();
  });
});

// Move chips (Dave 2026-08-07): adjusting WHEN something happens without
// opening a time picker. Position only; length is the job of the chips below.
describe("EventSheet move chips", () => {
  const openEdit = (initial: Record<string, string>, onSave = vi.fn()) => {
    render(
      <EventSheet mode="edit" initial={{ title: "Client Call", category: "c1", ...initial }}
        categories={CATS} onSave={onSave} onCancel={() => {}} />,
    );
    return onSave;
  };

  it("shifts start and end together, so the duration is untouched", () => {
    const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "11:30" });
    fireEvent.click(screen.getByText("+30m"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "10:30", end: "12:00" });
  });

  it("moves earlier too, which the swipe action never could", () => {
    const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "11:00" });
    fireEvent.click(screen.getByText("-15m"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "09:45", end: "10:45" });
  });

  it("stacks taps, so a bigger move is repeated taps and not a time picker", () => {
    const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "11:00" });
    fireEvent.click(screen.getByText("+30m"));
    fireEvent.click(screen.getByText("+30m"));
    fireEvent.click(screen.getByText("+15m"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "11:15", end: "12:15" });
  });

  it("Tomorrow moves the day and leaves the time alone", () => {
    const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "11:00" });
    fireEvent.click(screen.getByText("Tomorrow"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ date: "2026-05-27", start: "10:00", end: "11:00" });
  });

  it("refuses a move that would run past midnight instead of clamping it", () => {
    openEdit({ date: "2026-05-26", start: "23:30", end: "23:55" });
    const plus30 = screen.getByText("+30m");
    expect(plus30.className).toContain("chip-off");
    fireEvent.click(plus30);
    // Silently resizing the event to fit the day would be the wrong fix.
    expect(screen.getByDisplayValue("23:30")).toBeInTheDocument();
    expect(screen.getByDisplayValue("23:55")).toBeInTheDocument();
  });

  it("refuses a move back past midnight, and only the chip that would cross it", () => {
    openEdit({ date: "2026-05-26", start: "00:20", end: "01:00" });
    expect(screen.getByText("-30m").className).toContain("chip-off"); // 00:20 - 30 is yesterday
    expect(screen.getByText("-15m").className).not.toContain("chip-off"); // 00:05 is fine
  });

  it("moves an event with no end time set, leaving it without one", () => {
    const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "" });
    fireEvent.click(screen.getByText("+15m"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "10:15", end: "" });
  });

  it("offers no Tomorrow chip before a date exists", () => {
    render(<EventSheet mode="new" initial={{ date: "" }} categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Tomorrow")).not.toBeInTheDocument();
    expect(screen.getByText("+15m")).toBeInTheDocument();
  });
});
