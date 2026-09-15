// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReminderSheet from "./ReminderSheet";

// THE REMINDER FORM (push E, to Dave's interactive preview). What would you
// like to remember; when should it appear; the day, the time, two
// shortcuts, the rhythm; the green line; Area, Linked Action and Follow-up
// behind a disclosure. Save is never dead.
describe("ReminderSheet", () => {
  const TUE = "2026-09-15";
  const WED = "2026-09-16";
  const NOW = new Date(`${TUE}T09:00:00`).getTime();
  const base = { today: TUE, nowHHMM: "09:00", now: NOW, onCancel: () => {} };
  const cats = [{ id: "c-bridge", name: "Bridge", color: "teal" }];

  it("needs words and a time, says which at the field, and writes the explicit schedule", () => {
    const onSave = vi.fn();
    render(<ReminderSheet {...base} onSave={onSave} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Enter something to remember.")).toBeInTheDocument();
    expect(screen.getByText("Pick a time, or choose Unscheduled.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "21:00" } });
    fireEvent.click(screen.getByLabelText("Repeat"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Weekdays" }));
    expect(screen.getByText("Weekdays · 9:00 PM")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    const [text, r, extra] = onSave.mock.calls[0]!;
    expect(text).toBe("Meds");
    expect(r).toMatchObject({ time: "21:00", days: [1, 2, 3, 4, 5], onMiss: "let_go", scheduleKind: "timed", startDate: TUE, repeat: { kind: "weekdays", days: [1, 2, 3, 4, 5] }, followUp: null, tz: "local" });
    expect(extra.due).toBeNull();
    expect(extra.receipt).toBe("Reminder Set · Today, 9:00 PM");
  });

  it("Tomorrow Morning is one tap: the day, the morning time, one time, and the green line says so", () => {
    const onSave = vi.fn();
    render(<ReminderSheet {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Call the pharmacy" } });
    fireEvent.click(screen.getByText("Tomorrow Morning"));
    expect(screen.getByText("One Time · 8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Next Tomorrow, 8:00 AM")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    const [, r, extra] = onSave.mock.calls[0]!;
    expect(r.repeat).toEqual({ kind: "once" });
    expect(r.startDate).toBe(WED);
    expect(extra.due).toBe(WED);
    expect(extra.receipt).toBe("Reminder Set · Tomorrow, 8:00 AM");
  });

  it("reads the words as they are typed and shows its work as chips", () => {
    const onSave = vi.fn();
    render(<ReminderSheet {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Remind me to call the pharmacy tomorrow at 10am" } });
    expect(screen.getByText("Read from your words")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    const [text, r, extra] = onSave.mock.calls[0]!;
    expect(text).toBe("Call the pharmacy");
    expect(r.time).toBe("10:00");
    expect(extra.due).toBe(WED);
  });

  it("Unscheduled is explicit: no time field, no clock anywhere, and the save says so", () => {
    const onSave = vi.fn();
    const { container } = render(<ReminderSheet {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Call Mom" } });
    fireEvent.click(screen.getByLabelText("When should it appear"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Unscheduled" }));
    expect(screen.queryByLabelText("Time")).toBeNull();
    expect(screen.queryByLabelText("Repeat")).toBeNull();
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
    fireEvent.click(screen.getByText("Save"));
    const [, r, extra] = onSave.mock.calls[0]!;
    expect(r.scheduleKind).toBe("unscheduled");
    expect(r.startDate).toBeUndefined();
    expect(extra.due).toBeNull();
    expect(extra.receipt).toBe("Reminder Saved · Unscheduled");
  });

  it("When I Open the Area needs an area, then writes the trigger on it", () => {
    const onSave = vi.fn();
    render(<ReminderSheet {...base} categories={cats} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Do Bridge work first" } });
    fireEvent.click(screen.getByLabelText("When should it appear"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "When I Open the Area" }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Choose an area below.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Area"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Bridge/ }));
    expect(screen.getByText("When You Open Bridge")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Prompt cooldown"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "1 Day" }));
    fireEvent.click(screen.getByText("Save"));
    const [, r, extra] = onSave.mock.calls[0]!;
    expect(r.scheduleKind).toBe("unscheduled");
    expect(r.contextTrigger).toEqual({ kind: "onOpenArea", targetId: "c-bridge", cooldownMinutes: 1440, lastShownAt: null });
    expect(extra.category).toBe("c-bridge");
    expect(extra.receipt).toBe("Reminder Set · When you open Bridge");
  });

  it("After I Complete the Task needs a linked task, picked in the sheet", () => {
    const onSave = vi.fn();
    render(<ReminderSheet {...base} onSave={onSave} linkCandidates={[{ type: "task", id: "t9", label: "Bridge Priorities" }, { type: "note", id: "n1", label: "Q3 Plan" }]} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Then plan" } });
    fireEvent.click(screen.getByLabelText("When should it appear"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "After I Complete the Task" }));
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByText("Link a task below.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Linked Item"));
    fireEvent.click(screen.getByText("Bridge Priorities"));
    fireEvent.click(screen.getByText("Save"));
    const [, r] = onSave.mock.calls[0]!;
    expect(r.linkedItem).toEqual({ type: "task", id: "t9", label: "Bridge Priorities" });
    expect(r.contextTrigger).toMatchObject({ kind: "afterCompleteTask", targetId: "t9" });
  });

  it("a follow-up is opt-in, the settings default turns it on for a new reminder", () => {
    const onSave = vi.fn();
    const r1 = render(<ReminderSheet {...base} onSave={onSave} />);
    expect(screen.getByLabelText("Follow-up").textContent).toContain("None");
    r1.unmount();
    render(<ReminderSheet {...base} onSave={onSave} defaultFollowUp />);
    expect(screen.getByLabelText("Follow-up").textContent).toContain("Once After 1 Hour");
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.click(screen.getByText("In 1 Hour"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].followUp).toEqual({ delayMinutes: 60, maxCount: 1, stopAt: null });
    expect(onSave.mock.calls[0]![1].time).toBe("10:00");
  });

  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onSave = vi.fn();
    render(<ReminderSheet {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.click(screen.getByText("In 1 Hour"));
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("edit mode prefills the rule, the follow-up, the link, and offers the linked verb", () => {
    const onOpenLinked = vi.fn(); const onSave = vi.fn();
    const link = { type: "task" as const, id: "t9", label: "Bridge Priorities" };
    render(<ReminderSheet {...base} mode="edit" initial={{ text: "Stretch", reminder: { time: "07:00", days: [0, 6], linkedItem: link } }} onSave={onSave} onOpenLinked={onOpenLinked} />);
    expect((screen.getByLabelText("Reminder") as HTMLInputElement).value).toBe("Stretch");
    expect(screen.getByLabelText("Repeat").textContent).toContain("Weekends");
    expect(screen.getByLabelText("Follow-up").textContent).toContain("Once After 15 Minutes");
    fireEvent.click(screen.getByText("Open Task"));
    expect(onOpenLinked).toHaveBeenCalledWith(link);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].linkedItem).toEqual(link);
    expect(screen.queryByText("Delete Reminder")).toBeNull();
  });
});
