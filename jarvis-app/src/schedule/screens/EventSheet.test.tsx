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
    fireEvent.click(screen.getByRole("menuitemradio", { name: "20 min" }));
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("15:20");
    fireEvent.click(screen.getByLabelText("Buffer"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "10 min" }));
    expect((screen.getByLabelText("Leave by") as HTMLInputElement).value).toBe("15:10");
    fireEvent.change(screen.getByPlaceholderText(/happening/), { target: { value: "Practice" } });
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
    expect(screen.getByLabelText("Travel").textContent).toContain("40 min");
  });

  it("offers what was typed for this place last time, and a way to forget it", () => {
    const onSave = vi.fn();
    render(
      <EventSheet mode="new" initial={{ date: "2026-05-24", start: "15:40", location: "Rink 2" }} categories={CATS}
        travelMemory={{ "rink 2": 25 }} onSave={onSave} onCancel={() => {}} />,
    );
    expect(screen.getByText("25 min last time")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Travel"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Forget This Place" }));
    fireEvent.change(screen.getByPlaceholderText(/happening/), { target: { value: "Practice" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0].forgetTravel).toBe(true);
    expect(onSave.mock.calls[0]![0].travelMin).toBeUndefined();
  });
});

// UP-CORE-10 (2026-09-05): the meeting link, the agenda and the guest list.
describe("EventSheet: the meeting itself", () => {
  it("edits the link and the notes, on a hand-made event too", () => {
    const onSave = vi.fn();
    render(<EventSheet mode="new" initial={{ date: "2026-05-24" }} categories={CATS} onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Meeting Link"), { target: { value: "https://zoom.us/j/1" } });
    fireEvent.change(screen.getByLabelText("Meeting Notes"), { target: { value: "Q3 numbers" } });
    fireEvent.change(screen.getByPlaceholderText(/happening/), { target: { value: "Board sync" } });
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
