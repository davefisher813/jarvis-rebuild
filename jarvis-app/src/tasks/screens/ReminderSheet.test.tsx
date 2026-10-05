// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReminderSheet from "./ReminderSheet";

// THE REMINDER FORM (push E, to Dave's interactive preview). What would you
// like to remember; when should it appear; the day, the time, two
// shortcuts, the rhythm; the green line; Area, Linked Action and Follow-Up
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
    expect(screen.getByText("Pick a time to save this reminder, or choose Unscheduled.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "21:00" } });
    fireEvent.click(screen.getByLabelText("Repeat"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Weekdays" }));
    expect(screen.getByText("Weekdays at 9:00 PM")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    const [text, r, extra] = onSave.mock.calls[0]!;
    expect(text).toBe("Meds");
    expect(r).toMatchObject({ time: "21:00", days: [1, 2, 3, 4, 5], onMiss: "let_go", scheduleKind: "timed", startDate: TUE, repeat: { kind: "weekdays", days: [1, 2, 3, 4, 5] }, followUp: null, tz: "local" });
    expect(extra.due).toBeNull();
    expect(extra.receipt).toBe("Reminder Set · Today, 9:00 PM");
  });

  it("Save with words but no time says so at the Time field, stays dimmed until a time is picked, and never goes dead", () => {
    const onSave = vi.fn();
    render(<ReminderSheet {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Call Alberto" } });
    const save = screen.getByText("Save");
    expect(save).toHaveClass("dim"); // dimmed, still tappable
    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/^Pick a time to save this reminder/)).toBeInTheDocument();
    expect(screen.queryByText("Enter something to remember.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "10:30" } });
    expect(screen.queryByText(/^Pick a time to save this reminder/)).not.toBeInTheDocument();
    expect(screen.getByText("Save")).not.toHaveClass("dim");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // THE FIELD LANGUAGE (2026-10-05, the perfect bar): the Day and Time rows said "10/05/2026" and "--:-- --" with the browser's own
  // glyphs. They say "Today" and "Pick a Time" in the app's words, take the picked clock as "9:00 PM", the real native input lies
  // transparent over the whole row, and the two quick picks share one line instead of a row each.
  it("Day and Time say their value in words, not as raw native fields, and the quick picks share one line", () => {
    render(<ReminderSheet {...base} onSave={() => {}} />);
    const day = screen.getByLabelText("Start day").closest(".pick-row")!;
    const time = screen.getByLabelText("Time").closest(".pick-row")!;
    expect(day.querySelector(".xs-pick-v")).toHaveTextContent("Today");
    expect(time.querySelector(".xs-pick-v")).toHaveTextContent("Pick a Time");
    expect(time.querySelector(".xs-pick")).toHaveClass("xs-pick-off");
    expect(screen.getByLabelText("Time")).toHaveClass("pick-native");
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "21:00" } });
    expect(time.querySelector(".xs-pick-v")).toHaveTextContent("9:00 PM");
    const strip = screen.getByText("In 1 Hour").closest(".xs-strip")!;
    expect(strip.contains(screen.getByText("Tomorrow Morning")), "both quick picks on one line").toBe(true);
    expect(screen.getByText("Area, Linked Action and Follow-Up"), "hyphenated words are Title Case too").toBeInTheDocument();
  });

  it("Tomorrow Morning is one tap: the day, the morning time, one time, and the green line says so", () => {
    const onSave = vi.fn();
    render(<ReminderSheet {...base} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Call the pharmacy" } });
    fireEvent.click(screen.getByText("Tomorrow Morning"));
    expect(screen.getByText("One Time at 8:00 AM")).toBeInTheDocument();
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
    // "Tomorrow" is the read chip and the Day row's own word; "10:00 AM" likewise (the Time row says it too).
    expect(screen.getAllByText("Tomorrow").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("10:00 AM").length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByText("Save"));
    const [text, r, extra] = onSave.mock.calls[0]!;
    // The write door casing (Dave 2026-10-05): the title is saved in Title Case.
    expect(text).toBe("Call the Pharmacy");
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
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    expect(extra.receipt).toBe("Reminder Set · When You Open Bridge");
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
    expect(screen.getByLabelText("Follow-Up").textContent).toContain("None");
    r1.unmount();
    render(<ReminderSheet {...base} onSave={onSave} defaultFollowUp />);
    expect(screen.getByLabelText("Follow-Up").textContent).toContain("Once After 1 Hour");
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
    expect(screen.getByLabelText("Follow-Up").textContent).toContain("Once After 15 Minutes");
    fireEvent.click(screen.getByText("Open Task"));
    expect(onOpenLinked).toHaveBeenCalledWith(link);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].linkedItem).toEqual(link);
    expect(screen.queryByText("Delete Reminder")).toBeNull();
  });
});
