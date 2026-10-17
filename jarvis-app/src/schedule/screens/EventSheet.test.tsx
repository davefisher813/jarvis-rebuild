// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import EventSheet, { type SheetCategory } from "./EventSheet";

const CATS: SheetCategory[] = [
  { id: "c1", name: "Work", color: "blue" },
  { id: "c2", name: "Friends", color: "teal" },
];

// AMENDED 2026-09-26 (pass-off): durations read "45 Min", spelled and
// capitalized for minutes-only (Dave, the durations ruling), so the Travel and
// Buffer labels are "20 Min", "25 Min", "40 Min" here.
describe("EventSheet", () => {
  it("new mode: header, no delete", () => {
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("New Event")).toBeInTheDocument();
    expect(screen.queryByText("Delete Event")).not.toBeInTheDocument();
  });

  // THE PRIMARY FIELD OPENS FOCUSED (the Logging Standard, 2026-10-17).
  it("a new event opens on its title, keyboard up", () => {
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Event title"));
  });

  it("blocks save until title present, then saves the draft", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Needs Title · Date · Start")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Standup" } });
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
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Lunch" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ title: "Lunch", date: "2026-05-24", start: "09:00", end: "10:00", category: "c2", location: "", recurrence: "none", until: "", taskIds: [], gym: false });
  });

  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save used to
  // fire onSave every tap, so a fast double-tap wrote the event twice.
  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Standup" } });
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
    fireEvent.click(screen.getByText("+30 Min"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "10:30", end: "12:00" });
  });

  it("moves earlier too, which the swipe action never could", () => {
    const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "11:00" });
    fireEvent.click(screen.getByText("\u221215 Min"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "09:45", end: "10:45" });
  });

  it("stacks taps, so a bigger move is repeated taps and not a time picker", () => {
    const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "11:00" });
    fireEvent.click(screen.getByText("+30 Min"));
    fireEvent.click(screen.getByText("+30 Min"));
    fireEvent.click(screen.getByText("+15 Min"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "11:15", end: "12:15" });
  });

  // TOMORROW IS A MOVE OF THE DAY, SO IT LIVES ON THE DATE ROW (2026-10-05 review: it sat among the minute nudges, wrapping
  // 3 + 2 with them), as the row's one quiet text action, and only while the event is on today.
  it("Tomorrow moves the day and leaves the time alone, from the Date row", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-26T09:00:00"));
    try {
      const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "11:00" });
      const tomorrow = screen.getByText("Tomorrow");
      expect(tomorrow.closest(".xs-row")!.querySelector(".conn-name")!.textContent).toBe("Date");
      expect(tomorrow.closest(".xs-nudge")).toBeNull();
      fireEvent.click(tomorrow);
      fireEvent.click(screen.getByText("Save"));
      expect(onSave.mock.calls[0]![0]).toMatchObject({ date: "2026-05-27", start: "10:00", end: "11:00" });
    } finally { vi.useRealTimers(); }
  });

  it("offers Tomorrow only while the event is on today", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-26T09:00:00"));
    try {
      openEdit({ date: "2026-05-30", start: "10:00", end: "11:00" });
      expect(screen.queryByText("Tomorrow")).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  // THE QUICK-PICK MATCHES THE DATE (Alfred's deep audit 2026-10-13: "Tomorrow" looked selected over "Tue, Oct 13" while today WAS Oct 13).
  it("Today and Tomorrow are a pair, and the one that matches the date is the one that says so", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-26T09:00:00"));
    try {
      const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "11:00" });
      expect(screen.getByText("Today")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Tomorrow")).toHaveAttribute("aria-pressed", "false");
      fireEvent.click(screen.getByText("Tomorrow"));
      expect(screen.getByText("Tomorrow")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Today")).toHaveAttribute("aria-pressed", "false");
      // Back to today is one tap, and tapping the one already selected changes nothing.
      fireEvent.click(screen.getByText("Tomorrow"));
      fireEvent.click(screen.getByText("Today"));
      expect(screen.getByText("Today")).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(screen.getByText("Save"));
      expect(onSave.mock.calls[0]![0]).toMatchObject({ date: "2026-05-26" });
    } finally { vi.useRealTimers(); }
  });

  it("offers neither pick for a date that is neither today nor tomorrow", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-26T09:00:00"));
    try {
      openEdit({ date: "2026-05-30", start: "10:00", end: "11:00" });
      expect(screen.queryByText("Today")).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  // THE NUDGES ARE ONE STRIP OF FOUR EQUAL SEGMENTS, TITLE CASE, WITH A REAL MINUS (2026-10-05 review: "-30m" in lowercase
  // units, five chips wrapping 3 + 2).
  it("draws four equal segments in one strip, Title Case, with the real minus sign", () => {
    openEdit({ date: "2026-05-26", start: "10:00", end: "11:00" });
    const strip = document.querySelector(".xs-nudge")!;
    expect(strip.className).toContain("segmented");
    const labels = Array.from(strip.querySelectorAll(".seg")).map((e) => e.textContent);
    expect(labels).toEqual(["\u221230 Min", "\u221215 Min", "+15 Min", "+30 Min"]);
    expect(strip.querySelectorAll(".chip").length).toBe(0);
    expect(strip.textContent).not.toMatch(/\dm\b/);
  });

  it("refuses a move that would run past midnight instead of clamping it", () => {
    openEdit({ date: "2026-05-26", start: "23:30", end: "23:55" });
    const plus30 = screen.getByText("+30 Min");
    expect(plus30.className).toContain("seg-off");
    fireEvent.click(plus30);
    // Silently resizing the event to fit the day would be the wrong fix.
    expect(screen.getByDisplayValue("23:30")).toBeInTheDocument();
    expect(screen.getByDisplayValue("23:55")).toBeInTheDocument();
  });

  it("refuses a move back past midnight, and only the chip that would cross it", () => {
    openEdit({ date: "2026-05-26", start: "00:20", end: "01:00" });
    expect(screen.getByText("\u221230 Min").className).toContain("seg-off"); // 00:20 - 30 is yesterday
    expect(screen.getByText("\u221215 Min").className).not.toContain("seg-off"); // 00:05 is fine
  });

  it("moves an event with no end time set, leaving it without one", () => {
    const onSave = openEdit({ date: "2026-05-26", start: "10:00", end: "" });
    fireEvent.click(screen.getByText("+15 Min"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ start: "10:15", end: "" });
  });

  it("offers no Tomorrow chip before a date exists", () => {
    render(<EventSheet mode="new" initial={{ date: "" }} categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Tomorrow")).not.toBeInTheDocument();
    expect(screen.getByText("+15 Min")).toBeInTheDocument();
  });
});

// SCHED-F-11 (2026-09-05): "an Until before the start shows the error but Save
// proceeds". The red line was rendered from its own check and the save guard
// never read it, so the sheet closed and the series stayed endless.
describe("EventSheet: a series end before the start blocks the save", () => {
  const openSeries = (onSave = vi.fn()) => {
    render(
      <EventSheet mode="edit" categories={CATS} onSave={onSave} onCancel={() => {}}
        initial={{ title: "Clinic", date: "2026-05-26", start: "16:00", end: "17:00", category: "c1", recurrence: "weekly", until: "2026-05-01" }} />,
    );
    return onSave;
  };

  it("says Ends before it starts and refuses to save", () => {
    const onSave = openSeries();
    expect(screen.getByText("Ends before it starts")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves once the end is on or after the start", () => {
    const onSave = openSeries();
    fireEvent.change(screen.getByLabelText("Until date"), { target: { value: "2026-11-30" } });
    expect(screen.queryByText("Ends before it starts")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ until: "2026-11-30" });
  });
});

// LEAVE BY (UP-CORE-07, 2026-09-05). The rows exist only next to a place,
// because minutes to nowhere is a number with nothing behind it. The travel
// time is typed once per place and offered every time after; nothing is
// routed, learned or located.
describe("EventSheet: Leave By", () => {
  it("offers travel only with a place, computes the leave time, and saves both", () => {
    const onSave = vi.fn();
    render(
      <EventSheet mode="new" initial={{ date: "2026-05-24", start: "15:40" }} categories={CATS} onSave={onSave} onCancel={() => {}} />,
    );
    expect(screen.queryByLabelText("Travel")).toBeNull();
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Rink 2" } });
    fireEvent.click(screen.getByLabelText("Travel"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "20 Min" }));
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("15:20");
    fireEvent.click(screen.getByLabelText("Buffer"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "10 Min" }));
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("15:10");
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Practice" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ travelMin: 20, bufferMin: 10, location: "Rink 2" });
  });

  // The computed time is itself a chip you can override (A26 coverage map),
  // and moving it moves the travel minutes, so there is one number behind
  // both and they cannot disagree.
  it("overriding the leave time changes the travel minutes", () => {
    render(
      <EventSheet mode="new" initial={{ date: "2026-05-24", start: "15:40", location: "Rink 2", travelMin: 20 }} categories={CATS} onSave={() => {}} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Leave by"), { target: { value: "15:00" } });
    expect(screen.getByLabelText("Travel").textContent).toContain("40 Min");
  });

  it("offers what was typed for this place last time, and a way to forget it", () => {
    const onSave = vi.fn();
    render(
      <EventSheet mode="new" initial={{ date: "2026-05-24", start: "15:40", location: "Rink 2" }} categories={CATS}
        travelMemory={{ "rink 2": 25 }} onSave={onSave} onCancel={() => {}} />,
    );
    // Dave's pick, 2026-09-26: last time's minutes are a one-tap fill.
    expect(screen.getByRole("button", { name: "Use Last Time's 25 Min" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Travel"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Forget This Place" }));
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Practice" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0].forgetTravel).toBe(true);
    expect(onSave.mock.calls[0]![0].travelMin).toBeUndefined();
  });
});

describe("EventSheet: last time's travel is one tap", () => {
  it("tapping the offer sets Travel to last time's minutes, and saves them", () => {
    const onSave = vi.fn();
    render(
      <EventSheet mode="new" initial={{ date: "2026-05-24", start: "15:40", location: "Rink 2" }} categories={CATS}
        travelMemory={{ "rink 2": 25 }} onSave={onSave} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Last Time's 25 Min" }));
    expect(screen.getByLabelText("Travel").textContent).toContain("25 Min");
    // Filled, so the offer has done its job and goes.
    expect(screen.queryByRole("button", { name: "Use Last Time's 25 Min" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Practice" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0].travelMin).toBe(25);
  });
});

// UP-CORE-10 (2026-09-05): the meeting link, the agenda and the guest list.
describe("EventSheet: the meeting itself", () => {
  it("edits the link and the notes, on a hand-made event too", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Meeting Link"), { target: { value: "https://zoom.us/j/1" } });
    fireEvent.change(screen.getByLabelText("Meeting Notes"), { target: { value: "Q3 numbers" } });
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Board sync" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ url: "https://zoom.us/j/1", notes: "Q3 numbers" });
  });

  // The anti-drift rule: a guest already in Contacts opens the app's one
  // person card, and a guest who is not is one tap to add with the real
  // address, never a guess.
  it("opens a known guest and offers to add an unknown one", () => {
    const onOpenPerson = vi.fn();
    const onAddPerson = vi.fn();
    render(
      <EventSheet
        mode="edit"
        initial={{ title: "Board sync", date: "2026-05-24", attendees: [
          { email: "marco@example.com", name: "Marco Diaz" },
          { email: "nadia@example.com" },
        ] }}
        categories={CATS}
        knownPeople={[{ id: "p1", name: "Marco Diaz", email: "Marco@Example.com" }]}
        onOpenPerson={onOpenPerson}
        onAddPerson={onAddPerson}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Marco Diaz")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open"));
    expect(onOpenPerson).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByText("Add"));
    expect(onAddPerson).toHaveBeenCalledWith({ email: "nadia@example.com" });
  });
});

// UP-CORE-11 (2026-09-05): one event for Bio on Monday and Wednesday.
describe("EventSheet: weekly on chosen days", () => {
  it("shows the day chips only on a weekly repeat, and saves the set", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-20", start: "09:00" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    expect(screen.queryByLabelText("Monday")).toBeNull();
    fireEvent.click(screen.getByLabelText("Repeat"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Weekly" }));
    // 2026-05-20 is a Wednesday, and the anchor day reads as lit because it
    // is the day the event will run on.
    expect(screen.getByLabelText("Wednesday")).toHaveClass("active");
    fireEvent.click(screen.getByLabelText("Monday"));
    fireEvent.click(screen.getByLabelText("Every"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "2 Weeks" }));
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Bio" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ recurrence: "weekly", days: [1], interval: 2 });
  });
});

// Dave 2026-09-19: "the Meeting Notes control is a single-line input, so it
// can't hold multi-line text even if saving worked."
describe("EventSheet: the meeting notes are a paragraph", () => {
  it("is a textarea, and carries newlines through to the draft", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-20", start: "09:00" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    const notes = screen.getByLabelText("Meeting Notes");
    expect(notes.tagName).toBe("TEXTAREA");
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Bridge Foundation Zoom" } });
    fireEvent.change(screen.getByLabelText("Meeting Link"), { target: { value: "https://zoom.us/j/123" } });
    fireEvent.change(notes, { target: { value: "Dial in early.\nPasscode 4821." } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      url: "https://zoom.us/j/123",
      notes: "Dial in early.\nPasscode 4821.",
    });
  });
});

// THE SHEET'S ACTIONS ARE ACTIONS (the review, 2026-10-05): Duplicate and Move to Anytime act in place, so they draw no chevron
// (a chevron says "opens something"), and an empty pick draws no word None.
describe("EventSheet: actions, and empty picks", () => {
  const open = () => render(
    <EventSheet mode="edit" initial={{ title: "Client Call", category: "c1", date: "2026-05-26", start: "10:00" }} categories={CATS}
      onSave={() => {}} onCancel={() => {}} onMoveToAnytime={() => {}} onDuplicate={() => {}} onLogDecision={() => {}} onDelete={() => {}} />,
  );
  const rowOf = (label: string) => screen.getByText(label).closest(".row")!;

  it("Duplicate and Move to Anytime carry no chevron, Log the Decision (which opens a sheet) keeps its own", () => {
    open();
    expect(rowOf("Duplicate").querySelector(".chev")).toBeNull();
    expect(rowOf("Move to Anytime").querySelector(".chev")).toBeNull();
    expect(rowOf("Log the Decision").querySelector(".chev")).not.toBeNull();
  });

  it("an empty repeat draws no word None beside its label, and a chosen one is drawn as it was", () => {
    const { unmount } = open();
    expect(screen.getByRole("button", { name: "Repeat" }).classList.contains("dd-none")).toBe(true);
    unmount();
    render(<EventSheet mode="edit" initial={{ title: "Client Call", category: "c1", date: "2026-05-26", start: "10:00", recurrence: "weekly" }}
      categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    const rep = screen.getByRole("button", { name: "Repeat" });
    expect(rep.classList.contains("dd-none")).toBe(false);
    expect(rep.textContent).toBe("Weekly");
  });
});

// THE LOGGING STANDARD, rule 4 (2026-10-17): Return in the title saves, with
// the same refusal the Save tap gives a sheet that is missing its date.
describe("EventSheet: Return in the title saves", () => {
  it("Return saves a titled event with its defaults, and refuses an untitled one out loud", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    const title = screen.getByLabelText("Event title");
    fireEvent.keyDown(title, { key: "Enter" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Needs Title · Date · Start")).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Standup" } });
    fireEvent.keyDown(title, { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ title: "Standup", date: "2026-05-24", start: "09:00" });
  });
});

// A DRAFT THAT SURVIVES THE APP (the Logging Standard, rule 8, 2026-10-17): a
// new event's title is kept per keystroke, restored on the next open, spent by
// the save that used it and by an explicit Cancel, and kept on a scrim tap.
describe("EventSheet: a new event's title survives a remount", () => {
  const draw = (over: { title?: string } = {}, onCancel = () => {}) =>
    render(<EventSheet mode="new" initial={{ date: "2026-05-24", ...over }} categories={CATS} onSave={() => {}} onCancel={onCancel} />);
  const title = () => screen.getByLabelText("Event title") as HTMLInputElement;

  it("a half-typed title comes back after a remount, and the save spends it", async () => {
    localStorage.clear();
    const first = draw();
    fireEvent.change(title(), { target: { value: "Dentist" } });
    first.unmount();
    const second = draw();
    expect(title().value).toBe("Dentist");
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(localStorage.getItem("jarvis.event.draft.v1")).toBeNull());
    second.unmount();
    const third = draw();
    expect(title().value).toBe("");
    third.unmount();
  });

  it("Cancel is the discard, the scrim keeps it, and a caller's title loses only to a draft", () => {
    localStorage.clear();
    const onCancel = vi.fn();
    const first = draw({}, onCancel);
    fireEvent.change(title(), { target: { value: "Dentist" } });
    fireEvent.click(document.querySelector(".sheet-scrim") as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
    first.unmount();
    // The scrim kept it, and it beats the title the caller handed in.
    const second = draw({ title: "Standup" }, onCancel);
    expect(title().value).toBe("Dentist");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    second.unmount();
    // Cancel spent it, so the caller's title stands.
    const third = draw({ title: "Standup" });
    expect(title().value).toBe("Standup");
    third.unmount();
  });

  it("an edit neither reads nor writes the draft", () => {
    localStorage.clear();
    localStorage.setItem("jarvis.event.draft.v1", "Dentist");
    const r = render(<EventSheet mode="edit" initial={{ date: "2026-05-24", title: "Standup" }} categories={CATS} onSave={() => {}} onCancel={() => {}} />);
    expect(title().value).toBe("Standup");
    fireEvent.change(title(), { target: { value: "Standup Moved" } });
    expect(localStorage.getItem("jarvis.event.draft.v1")).toBe("Dentist");
    r.unmount();
    localStorage.clear();
  });
});
