// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RemindersHome from "./RemindersHome";
import type { TaskItem } from "../TasksService";
import type { ReminderInfo } from "../../notes/types";

// REMINDERS HOME (the reminders rebuild push B, 2026-09-15). Organised by
// when; the row is the door; the ring completes; nothing shaped like a
// clock sits beside an unscheduled reminder.
const item = (r: ReminderInfo, text: string, id: string, category = ""): TaskItem =>
  ({ id, data: { text, category, done: false, reminder: r } } as TaskItem);

const TUE = "2026-09-15";
const noop = () => {};

describe("RemindersHome", () => {
  const items = [
    item({ time: "09:00", days: [1, 2, 3, 4, 5] }, "Bridge Planning", "now1"),
    item({ time: "14:00" }, "Call Alberto", "later1"),
    item({ time: "09:00", repeat: { kind: "once" }, startDate: "2026-09-29" }, "Review This Decision", "up1"),
    item({ time: "08:00", scheduleKind: "unscheduled" }, "Call Mom", "un1"),
    item({ time: "07:00", paused: true }, "Stretch", "p1"),
    item({ time: "07:00", lastDone: TUE }, "Water", "done1"),
  ];

  it("lays the day out by when, with each section's count", () => {
    render(<RemindersHome items={items} today={TUE} now="09:30" onBack={noop} onAdd={noop} onOpen={noop} onTick={noop} onSnooze={noop} onPause={noop} />);
    for (const label of ["Now", "Later Today", "Upcoming"]) expect(screen.getByText(label)).toBeInTheDocument();
    // The head and the row fact both say the word.
    expect(screen.getAllByText("Unscheduled").length).toBe(2);
    expect(screen.getByText("Paused · 1")).toBeInTheDocument();
    expect(screen.getByText("Completed Today · 1")).toBeInTheDocument();
    expect(screen.getByText("Today, 9:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Today, 2:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Weekdays")).toBeInTheDocument();
    expect(screen.getByText(/Sep 29, 9:00 AM/)).toBeInTheDocument();
  });

  it("the unscheduled row says the word, explains itself, and shows no clock", () => {
    render(<RemindersHome items={[items[3]!]} today={TUE} now="09:30" onBack={noop} onAdd={noop} onOpen={noop} onTick={noop} onSnooze={noop} onPause={noop} />);
    const row = screen.getByText("Call Mom").closest(".rem-row")!;
    expect(row.textContent).toContain("Unscheduled");
    expect(row.textContent).toContain("No timed alert.");
    expect(row.textContent).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  it("the row is the door, the ring completes, Snooze pushes, Add a Time opens, Resume resumes", () => {
    const onOpen = vi.fn(); const onTick = vi.fn(); const onSnooze = vi.fn(); const onPause = vi.fn();
    render(<RemindersHome items={items} today={TUE} now="09:30" onBack={noop} onAdd={noop} onOpen={onOpen} onTick={onTick} onSnooze={onSnooze} onPause={onPause} />);
    fireEvent.click(screen.getByText("Bridge Planning"));
    expect(onOpen).toHaveBeenCalledWith("now1");
    fireEvent.click(screen.getByLabelText("Mark Bridge Planning done"));
    expect(onTick).toHaveBeenCalledWith("now1", true);
    fireEvent.click(screen.getAllByText("Snooze 10m")[0]!);
    expect(onSnooze).toHaveBeenCalledWith("now1");
    fireEvent.click(screen.getByText("Add a Time"));
    expect(onOpen).toHaveBeenCalledWith("un1");
    fireEvent.click(screen.getByText("Resume"));
    expect(onPause).toHaveBeenCalledWith("p1", false);
    // A tap on a pill never also opens the row.
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByLabelText("Undo Water"));
    expect(onTick).toHaveBeenCalledWith("done1", false);
  });

  it("with nothing at all, one labelled Add row and the bar's Add", () => {
    const onAdd = vi.fn();
    render(<RemindersHome items={[]} today={TUE} now="09:30" onBack={noop} onAdd={onAdd} onOpen={noop} onTick={noop} onSnooze={noop} onPause={noop} />);
    fireEvent.click(screen.getByText("Add a Reminder"));
    fireEvent.click(screen.getByLabelText("New Reminder"));
    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Now")).toBeNull();
  });

  it("Back goes back", () => {
    const onBack = vi.fn();
    render(<RemindersHome items={items} today={TUE} now="09:30" onBack={onBack} onAdd={noop} onOpen={noop} onTick={noop} onSnooze={noop} onPause={noop} />);
    fireEvent.click(screen.getByText("Today"));
    expect(onBack).toHaveBeenCalled();
  });
});

// PUSH C: a linked reminder's row carries its verb, and opening it never
// completes it.
describe("RemindersHome, the primary action", () => {
  it("shows the verb for the linked record and opens it without ticking", () => {
    const onOpenLinked = vi.fn(); const onTick = vi.fn(); const onOpen = vi.fn();
    const link = { type: "email" as const, id: "th1", label: "Alberto" };
    render(<RemindersHome items={[item({ time: "14:00", linkedItem: link }, "Follow Up With Alberto", "l1")]} today={TUE} now="09:30"
      onBack={noop} onAdd={noop} onOpen={onOpen} onTick={onTick} onSnooze={noop} onPause={noop} onOpenLinked={onOpenLinked} />);
    fireEvent.click(screen.getByText("Open Conversation"));
    expect(onOpenLinked).toHaveBeenCalledWith(link);
    expect(onTick).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
