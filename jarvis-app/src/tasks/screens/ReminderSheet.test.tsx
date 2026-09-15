// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReminderSheet from "./ReminderSheet";
import { todayISO } from "../grouping";
import { addDays } from "../../schedule/calendar";

// THE REMINDER SHEET, REBUILT (the reminders rebuild, 2026-09-15). Quick
// creation is what to remember, when, Save; timed or unscheduled is said
// explicitly; everything else waits behind More Options; Save always says
// what is missing; the receipt names the next moment it fires.
describe("ReminderSheet", () => {
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  // A fixed clock so "In 15 Minutes" is a known time.
  const NOW = new Date(`${today}T09:00:00`).getTime();

  it("needs a name and a time, says which at the field, and writes the explicit schedule", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
    expect(screen.getByText("Pick a time, or mark this Unscheduled.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.click(screen.getByText("9 PM"));
    fireEvent.click(screen.getByLabelText("Repeat"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Weekdays" }));
    // Follow-up is opt-in and off until chosen: the menu reads None.
    expect(screen.getByLabelText("Follow-up").textContent).toContain("None");
    fireEvent.click(screen.getByText("Save"));
    const [text, r, extra] = onSave.mock.calls[0]!;
    expect(text).toBe("Meds");
    expect(r).toMatchObject({ time: "21:00", days: [1, 2, 3, 4, 5], onMiss: "let_go", scheduleKind: "timed", startDate: today, repeat: { kind: "weekdays", days: [1, 2, 3, 4, 5] }, followUp: null, tz: "local" });
    // A repeating reminder never becomes an overdue task: due stays null,
    // the start lives on the reminder.
    expect(extra.due).toBeNull();
    expect(extra.category).toBe("");
    expect(extra.receipt).toMatch(/^Reminder Set · /);
  });

  it("Tomorrow Morning is one tap: the day, the morning time, Just Once, and a receipt that names it", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Call the pharmacy" } });
    fireEvent.click(screen.getByText("Tomorrow Morning"));
    expect(screen.getByLabelText("Repeat").textContent).toContain("Just Once");
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("08:00");
    fireEvent.click(screen.getByText("Save"));
    const [, r, extra] = onSave.mock.calls[0]!;
    expect(r.days, "Just Once stores no day pattern, which is what once means").toBeUndefined();
    expect(r.repeat).toEqual({ kind: "once" });
    expect(r.startDate).toBe(tomorrow);
    expect(extra.due, "a one-off writes its day to the task's own due").toBe(tomorrow);
    expect(extra.receipt).toBe("Reminder Set · Tomorrow, 8:00 AM");
  });

  it("In 15 Minutes reads the clock it was given", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Move the car" } });
    fireEvent.click(screen.getByText("In 15 Minutes"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].time).toBe("09:15");
    expect(onSave.mock.calls[0]![2].receipt).toBe("Reminder Set · Today, 9:15 AM");
  });

  it("reads the words as they are typed and shows its work as chips", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Remind me to call the pharmacy tomorrow at 10am" } });
    expect(screen.getByText("Read from your words")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();
    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    const [text, r, extra] = onSave.mock.calls[0]!;
    expect(text).toBe("Call the pharmacy");
    expect(r.time).toBe("10:00");
    expect(extra.due).toBe(tomorrow);
  });

  it("a word it cannot read is left alone: nothing is guessed for it", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Call Mom later" } });
    expect(screen.queryByText("Read from your words")).toBeNull();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Pick a time, or mark this Unscheduled.")).toBeInTheDocument();
  });

  it("Unscheduled is explicit: no time field, no clock anywhere, and the save says so", () => {
    const onSave = vi.fn();
    const { container } = render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Call Mom" } });
    fireEvent.click(screen.getByText("Unscheduled"));
    expect(screen.queryByLabelText("Time")).toBeNull();
    expect(screen.queryByLabelText("Repeat")).toBeNull();
    expect(screen.getByText("No timed alert")).toBeInTheDocument();
    // THE INVARIANT: nothing shaped like a clock time is on the sheet.
    expect(container.textContent).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
    fireEvent.click(screen.getByText("Save"));
    const [, r, extra] = onSave.mock.calls[0]!;
    expect(r.scheduleKind).toBe("unscheduled");
    expect(r.startDate).toBeUndefined();
    expect(extra.due).toBeNull();
    expect(extra.receipt).toBe("Reminder Saved · Unscheduled");
  });

  it("files to an area when the caller has areas to offer, and shows no row when it does not", () => {
    const onSave = vi.fn();
    const { rerender } = render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    expect(screen.queryByLabelText("Area")).toBeNull();
    rerender(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} categories={[{ id: "c1", name: "Health", color: "green" }]} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.click(screen.getByText("8 AM"));
    fireEvent.click(screen.getByLabelText("Area"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Health/ }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![2].category).toBe("c1");
  });

  it("a follow-up, once chosen, is written capped and explicit", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.click(screen.getByText("8 AM"));
    fireEvent.click(screen.getByLabelText("Follow-up"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Ask Again in 30m" }));
    fireEvent.click(screen.getByLabelText("Follow-ups at most"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "2 Times" }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].followUp).toEqual({ delayMinutes: 30, maxCount: 2, stopAt: null });
    expect(onSave.mock.calls[0]![1].onMiss).toBe("nag");
  });

  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save used to
  // fire onSave every tap, so a fast double-tap wrote the reminder twice.
  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onSave = vi.fn();
    render(<ReminderSheet onSave={onSave} onCancel={() => {}} now={NOW} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Meds" } });
    fireEvent.click(screen.getByText("8 AM"));
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("edit mode prefills, reads the rule back, and offers Pause, Export to Calendar and Delete", () => {
    const onDelete = vi.fn();
    const onAddToCalendar = vi.fn();
    const onPause = vi.fn();
    render(<ReminderSheet mode="edit" initial={{ text: "Stretch", reminder: { time: "07:00", days: [0, 6], doneCount: 3 } }}
      onSave={() => {}} onDelete={onDelete} onAddToCalendar={onAddToCalendar} onPause={onPause} onCancel={() => {}} now={NOW} />);
    expect((screen.getByLabelText("Reminder") as HTMLInputElement).value).toBe("Stretch");
    expect(screen.getByLabelText("Repeat").textContent).toContain("Weekends");
    // A reminder written before follow-up existed keeps what its default
    // meant: one ask fifteen minutes on.
    expect(screen.getByLabelText("Follow-up").textContent).toContain("15m");
    fireEvent.click(screen.getByText("Pause"));
    expect(onPause).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText("Export to Calendar"));
    expect(onAddToCalendar).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete Reminder"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("a paused reminder offers Resume", () => {
    const onPause = vi.fn();
    render(<ReminderSheet mode="edit" initial={{ text: "Stretch", reminder: { time: "07:00", paused: true } }}
      onSave={() => {}} onPause={onPause} onCancel={() => {}} now={NOW} />);
    fireEvent.click(screen.getByText("Resume"));
    expect(onPause).toHaveBeenCalledWith(false);
  });
});

// PUSH C (2026-09-15): what the reminder is about, this occurrence, the
// advice, the history. Each of these writes at once, not on Save.
describe("ReminderSheet, push C", () => {
  const TUE = "2026-09-15";
  const NOW = new Date(`${TUE}T09:00:00`).getTime();
  const link = { type: "task" as const, id: "t9", label: "Bridge Priorities" };

  it("a linked reminder leads with its verb, and the link rides in the save", () => {
    const onOpenLinked = vi.fn();
    const onSave = vi.fn();
    render(<ReminderSheet mode="edit" today={TUE} nowHHMM="09:00" now={NOW} initial={{ text: "Bridge Planning", reminder: { time: "09:30", linkedItem: link } }}
      onSave={onSave} onOpenLinked={onOpenLinked} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Open Task"));
    expect(onOpenLinked).toHaveBeenCalledWith(link);
    expect(screen.getAllByText("Bridge Priorities").length).toBe(2);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].linkedItem).toEqual(link);
  });

  it("the picker links a record and No Link clears it", () => {
    const onSave = vi.fn();
    render(<ReminderSheet today={TUE} nowHHMM="09:00" now={NOW} linkCandidates={[{ type: "note", id: "n1", label: "Q3 Plan" }, { type: "contact", id: "p1", label: "Alberto" }]}
      onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Follow up" } });
    fireEvent.click(screen.getByText("8 AM"));
    fireEvent.click(screen.getAllByText("Linked Item")[1]!);
    fireEvent.change(screen.getByLabelText("Search items to link"), { target: { value: "alb" } });
    expect(screen.queryByText("Q3 Plan")).toBeNull();
    fireEvent.click(screen.getByText("Alberto"));
    expect(screen.getByText("Alberto")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].linkedItem).toEqual({ type: "contact", id: "p1", label: "Alberto" });
  });

  it("this occurrence can be moved or skipped, and says which day it means", () => {
    const onSkip = vi.fn(); const onReschedule = vi.fn();
    render(<ReminderSheet mode="edit" today={TUE} nowHHMM="09:00" now={NOW} initial={{ text: "Meds", reminder: { time: "21:00" } }}
      onSave={() => {}} onSkip={onSkip} onReschedule={onReschedule} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Skip Today"));
    expect(onSkip).toHaveBeenCalledWith(TUE);
    fireEvent.change(screen.getByLabelText("Move this occurrence to"), { target: { value: "14:30" } });
    expect(onReschedule).toHaveBeenCalledWith(TUE, "14:30");
  });

  it("a weekday reminder on a Saturday offers its Monday occurrence", () => {
    const onSkip = vi.fn();
    render(<ReminderSheet mode="edit" today="2026-09-19" nowHHMM="09:00" now={NOW} initial={{ text: "Bridge Planning", reminder: { time: "09:00", days: [1, 2, 3, 4, 5] } }}
      onSave={() => {}} onSkip={onSkip} onCancel={() => {}} />);
    fireEvent.click(screen.getByText(/^Skip Mon/));
    expect(onSkip).toHaveBeenCalledWith("2026-09-21");
  });

  it("three snoozes running is advice with three answers; nothing changes on its own", () => {
    const onKeep = vi.fn(); const onPause = vi.fn(); const onSave = vi.fn();
    const history = ["a", "b", "c"].map((at) => ({ at, kind: "snoozed" as const }));
    render(<ReminderSheet mode="edit" today={TUE} nowHHMM="09:00" now={NOW} initial={{ text: "Meds", reminder: { time: "21:00", history } }}
      onSave={onSave} onKeepSchedule={onKeep} onPause={onPause} onCancel={() => {}} />);
    expect(screen.getByText("Snoozed the last 3 times · Choose a better time?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep Schedule"));
    expect(onKeep).toHaveBeenCalled();
    fireEvent.click(screen.getAllByText("Pause")[0]!);
    expect(onPause).toHaveBeenCalledWith(true);
    expect(onSave).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("21:00");
  });

  it("Move It There puts the usual time in the field, and Save writes it", () => {
    const onSave = vi.fn();
    const history = Array.from({ length: 8 }, (_, i) => ({ at: `2026-09-0${i + 1}T21:45:00`, kind: "completed" as const }));
    render(<ReminderSheet mode="edit" today={TUE} nowHHMM="09:00" now={NOW} initial={{ text: "Meds", reminder: { time: "21:00", history } }}
      onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Move It There"));
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("21:45");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].time).toBe("21:45");
  });

  it("history reads newest first, in words", () => {
    const history = [
      { at: "2026-09-14T21:05:00", kind: "completed" as const },
      { at: `${TUE}T08:00:00`, kind: "snoozed" as const, meta: { to: "08:10" } },
    ];
    render(<ReminderSheet mode="edit" today={TUE} nowHHMM="09:00" now={NOW} initial={{ text: "Meds", reminder: { time: "21:00", history } }}
      onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("Snoozed to 8:10 AM")).toBeInTheDocument();
    expect(screen.getByText("Today, 8:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Yesterday, 9:05 PM")).toBeInTheDocument();
  });

  it("an unscheduled reminder has no occurrence to move or skip", () => {
    render(<ReminderSheet mode="edit" today={TUE} nowHHMM="09:00" now={NOW} initial={{ text: "Call Mom", reminder: { time: "08:00", scheduleKind: "unscheduled" } }}
      onSave={() => {}} onSkip={() => {}} onReschedule={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("This Occurrence")).toBeNull();
  });
});

// PUSH D: Show When. A prompt in the app, never a gate, written with the
// rest on Save; offered only when there is an area or a linked task to
// hang it on.
describe("ReminderSheet, Show When", () => {
  const TUE = "2026-09-15";
  const NOW = new Date(`${TUE}T09:00:00`).getTime();

  it("is not offered with nothing to hang it on", () => {
    render(<ReminderSheet today={TUE} nowHHMM="09:00" now={NOW} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText("Show when")).toBeNull();
  });

  it("with an area chosen, When I Open the Area writes the trigger on that area with a cooldown", () => {
    const onSave = vi.fn();
    render(<ReminderSheet today={TUE} nowHHMM="09:00" now={NOW} categories={[{ id: "c-bridge", name: "Bridge", color: "teal" }]} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Reminder"), { target: { value: "Do Bridge work first" } });
    fireEvent.click(screen.getByText("Unscheduled"));
    fireEvent.click(screen.getByLabelText("Area"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Bridge/ }));
    fireEvent.click(screen.getByLabelText("Show when"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "When I Open the Area" }));
    fireEvent.click(screen.getByLabelText("Prompt cooldown"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "1 Day" }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].contextTrigger).toEqual({ kind: "onOpenArea", targetId: "c-bridge", cooldownMinutes: 1440, lastShownAt: null });
  });

  it("with a linked task, After I Complete the Task targets that task; Never clears it", () => {
    const onSave = vi.fn();
    const link = { type: "task" as const, id: "t9", label: "Bridge Priorities" };
    render(<ReminderSheet mode="edit" today={TUE} nowHHMM="09:00" now={NOW} initial={{ text: "Then plan", reminder: { time: "09:00", linkedItem: link, contextTrigger: { kind: "afterCompleteTask", targetId: "t9", cooldownMinutes: 60, lastShownAt: "2026-09-14T09:00:00Z" } } }}
      onSave={onSave} onCancel={() => {}} />);
    expect(screen.getByLabelText("Show when").textContent).toContain("After I Complete the Task");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].contextTrigger).toMatchObject({ kind: "afterCompleteTask", targetId: "t9", cooldownMinutes: 60, lastShownAt: "2026-09-14T09:00:00Z" });
  });

  it("Never clears a trigger that was set", () => {
    const onSave = vi.fn();
    const link = { type: "task" as const, id: "t9", label: "Bridge Priorities" };
    render(<ReminderSheet mode="edit" today={TUE} nowHHMM="09:00" now={NOW} initial={{ text: "Then plan", reminder: { time: "09:00", linkedItem: link, contextTrigger: { kind: "afterCompleteTask", targetId: "t9", cooldownMinutes: 60, lastShownAt: null } } }}
      onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText("Show when"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Never" }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![1].contextTrigger).toBeUndefined();
  });
});
