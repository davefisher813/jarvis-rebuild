// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "../schedule/ScheduleService";
import MeetingFinishCard, { type MeetingNotice } from "./MeetingFinishCard";
import ThreadStateCard from "./ThreadStateCard";
import { addEmailMeetingOnce, resetEmailScheduleState } from "./emailSchedule";
import { readWhen } from "./meetingRead";
import type { MeetingCandidate, MeetingStatus } from "./mailContracts";
import type { Brief } from "./brief";

const TODAY = "2026-09-21"; // a Monday
const ME = "dave@me.com";
const NY = "America/New_York";
let seq = 0;

// Built by the same reader the brief uses, so these are the real required sentences.
function cand(messageId: string, quote: string, status: MeetingStatus = "agreed", title = "Practice", sourceDay = TODAY): MeetingCandidate {
  const w = readWhen(quote, sourceDay);
  const end = w.start ? `${String(Math.min(23, Number(w.start.slice(0, 2)) + 1)).padStart(2, "0")}:${w.start.slice(3)}` : undefined;
  return {
    id: "mc_t" + ++seq, sourceMessageId: messageId, sourceQuote: quote, title, status,
    ...(w.date ? { date: w.date } : {}), ...(w.start ? { start: w.start } : {}), ...(end ? { end } : {}),
    ...(w.dayPart ? { dayPart: w.dayPart } : {}), ...(w.timeZone ? { timeZone: w.timeZone } : {}),
    missing: w.missing, durationSource: "default",
  };
}

const setup = () => {
  const store = new Store(new InMemoryAdapter());
  const svc = new ScheduleService(store, "u1");
  return { store, svc };
};
const renderCard = (svc: ScheduleService, candidates: MeetingCandidate[] | undefined, extra: { onNotice?: (n: MeetingNotice) => void; order?: string[] } = {}) =>
  render(<MeetingFinishCard scheduleSvc={svc} threadId="t1" account={ME} candidates={candidates} order={extra.order ?? ["m1", "m2", "m3"]} today={TODAY} zone={NY} {...(extra.onNotice ? { onNotice: extra.onNotice } : {})} />);

beforeEach(() => { resetEmailScheduleState(); cleanup(); });

describe("MeetingFinishCard: the offer, above the messages", () => {
  it("is visible without expanding the state card, and the state card carries no calendar action", () => {
    const { svc } = setup();
    const brief: Brief = { summary: "s", replies: [], state: "scheduled", agreed: ["Tuesday at 3 PM"], meeting: { title: "Practice", date: "2026-09-22", start: "15:00", end: "16:00" } };
    render(
      <>
        <MeetingFinishCard scheduleSvc={svc} threadId="t1" account={ME} candidates={[cand("m1", "See you Tuesday at 3 PM")]} order={["m1"]} today={TODAY} zone={NY} />
        <ThreadStateCard brief={brief} />
      </>,
    );
    // The state card is collapsed: its detail is behind "More".
    expect(screen.queryByText("Agreed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Calendar" })).toBeInTheDocument();
    // And it is not in the state card: exactly one Add to Calendar on the screen.
    expect(screen.getAllByText("Add to Calendar")).toHaveLength(1);
    const stateCard = screen.getByText("Where This Stands").closest(".card")!;
    expect(within(stateCard as HTMLElement).queryByText("Add to Calendar")).not.toBeInTheDocument();
  });

  it("draws nothing when nothing was analysed, when there are none, and when the times are only proposed", () => {
    const { svc } = setup();
    const a = renderCard(svc, undefined);
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();
    const b = renderCard(svc, []);
    expect(b.container).toBeEmptyDOMElement();
    b.unmount();
    const c = renderCard(svc, [cand("m1", "Could do Tuesday at 3 PM", "proposed"), cand("m1", "or Wednesday at 10 AM", "proposed")]);
    expect(c.container).toBeEmptyDOMElement();
  });

  it("a whole answer shows the day, the time, the zone and the labelled default length, and writes nothing until the tap", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM")]);
    expect(screen.getByText("Practice")).toBeInTheDocument();
    expect(screen.getByText(/Tomorrow/)).toBeInTheDocument();
    expect(screen.getByText("3:00 PM")).toBeInTheDocument();
    expect(screen.getByText(/EDT/)).toBeInTheDocument();
    // Never presented as the sender's own length.
    expect(screen.getByText("1h \u00b7 Default")).toBeInTheDocument();
    await waitFor(() => expect(svc.listEvents()).resolves.toHaveLength(0));
  });

  it("Add writes one event and shows the receipt inline, with an Undo", async () => {
    const { svc } = setup();
    const notices: MeetingNotice[] = [];
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM")], { onNotice: (n) => notices.push(n) });
    fireEvent.click(screen.getByRole("button", { name: "Add to Calendar" }));
    await screen.findByText("On Your Calendar");
    const evs = await svc.listEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0]!.data).toMatchObject({ title: "Practice", date: "2026-09-22", start: "15:00", end: "16:00" });
    expect(screen.queryByRole("button", { name: "Add to Calendar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(notices[0]!.message).toContain("On Your Calendar");
    expect(notices[0]!.undo?.label).toBe("Undo");
  });

  it("two quick taps are one event", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM")]);
    const btn = screen.getByRole("button", { name: "Add to Calendar" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByText("On Your Calendar");
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("the row itself is a door: tapping the words adds", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM")]);
    fireEvent.click(screen.getByText("Practice"));
    await screen.findByText("On Your Calendar");
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("Undo removes the event and puts the offer back", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM")]);
    fireEvent.click(screen.getByRole("button", { name: "Add to Calendar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await screen.findByRole("button", { name: "Add to Calendar" });
    expect(await svc.listEvents()).toHaveLength(0);
  });

  it("an Undo that fails says so and leaves the event and the receipt alone", async () => {
    const { svc } = setup();
    const notices: MeetingNotice[] = [];
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM")], { onNotice: (n) => notices.push(n) });
    fireEvent.click(screen.getByRole("button", { name: "Add to Calendar" }));
    const undo = await screen.findByRole("button", { name: "Undo" });
    (svc as unknown as { deleteEvent: unknown }).deleteEvent = async () => { throw new Error("offline"); };
    fireEvent.click(undo);
    await waitFor(() => expect(screen.getAllByText(/Couldn't Remove It/).length).toBeGreaterThan(0));
    expect(await svc.listEvents()).toHaveLength(1);
    expect(screen.getByText("On Your Calendar")).toBeInTheDocument();
  });

  it("a create that fails says nothing was saved, and offers Add again", async () => {
    const { svc } = setup();
    (svc as unknown as { createEvent: unknown }).createEvent = async () => { throw new Error("offline"); };
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM")]);
    fireEvent.click(screen.getByRole("button", { name: "Add to Calendar" }));
    await screen.findByText(/Nothing Was Saved/);
    expect(await svc.listEvents()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Add to Calendar" })).toBeInTheDocument();
  });

  it("a reload finds the event that is already on the calendar and does not offer to add it again", async () => {
    const { svc } = setup();
    const c = cand("m1", "See you Tuesday at 3 PM");
    await addEmailMeetingOnce({ scheduleSvc: svc, candidate: c, threadId: "t1", account: ME, zone: NY });
    resetEmailScheduleState();
    renderCard(svc, [c]);
    await screen.findByText("On Your Calendar");
    expect(screen.queryByRole("button", { name: "Add to Calendar" })).not.toBeInTheDocument();
    expect(await svc.listEvents()).toHaveLength(1);
  });
});

describe("MeetingFinishCard: missing details are requested, never guessed", () => {
  it("Tuesday at 3: asks AM or PM as 3 AM and 3 PM, and writes nothing until one is picked", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "Tuesday at 3")]);
    expect(screen.getByText(/AM or PM\?/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add to Calendar" })).not.toBeInTheDocument();
    expect(await svc.listEvents()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add as 3 PM" }));
    await screen.findByText("On Your Calendar");
    expect((await svc.listEvents())[0]!.data).toMatchObject({ date: "2026-09-22", start: "15:00", end: "16:00" });
  });

  it("the other choice is honoured: Add as 3 AM is 03:00", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "Tuesday at 3")]);
    fireEvent.click(screen.getByRole("button", { name: "Add as 3 AM" }));
    await screen.findByText("On Your Calendar");
    expect((await svc.listEvents())[0]!.data.start).toBe("03:00");
  });

  it("tomorrow at 10: resolved against the source message's day, and asks", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "Tomorrow at 10?")]);
    expect(screen.getByText(/Tomorrow/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add as 10 AM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add as 10 PM" })).toBeInTheDocument();
  });

  it("Thursday morning: asks for a time, and the sheet opens on the day with the time left blank (not 9 AM)", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "Thursday morning works")]);
    expect(screen.getByText(/Morning/)).toBeInTheDocument();
    expect(await svc.listEvents()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Set Time" }));
    // The existing event sheet, prefilled.
    expect(await screen.findByText("New Event")).toBeInTheDocument();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-09-24");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Event title") as HTMLInputElement).value).toBe("Practice");
    // Saving without a time is refused by the sheet itself.
    fireEvent.click(screen.getByText("Save"));
    expect(await svc.listEvents()).toHaveLength(0);
    // Give it a time and the event is made, once, through the same door.
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "09:30" } });
    // Whatever else is typed on the sheet is written too, not dropped on Save.
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Field 3" } });
    fireEvent.change(screen.getByLabelText("Meeting Notes"), { target: { value: "Bring cleats" } });
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText("On Your Calendar");
    const evs = await svc.listEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0]!.data).toMatchObject({ date: "2026-09-24", start: "09:30", location: "Field 3", notes: "Bring cleats" });
    // And it is still the one door's row: keyed, so a second Save would not make another.
    expect(evs[0]!.data.clientId).toMatch(/^emailmtg_/);
  });

  it("no day at all: Set Day opens the sheet", async () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "Does 3 PM work for you")]);
    fireEvent.click(screen.getByRole("button", { name: "Set Day" }));
    expect(await screen.findByText("New Event")).toBeInTheDocument();
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("15:00");
  });

  it("a sender's zone is shown, and the reader's own time beside it", () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "See you Tuesday at 10 AM PT")]);
    expect(screen.getByText(/PDT/)).toBeInTheDocument();
    expect(screen.getByText(/1:00 PM Your Time/)).toBeInTheDocument();
  });
});

describe("MeetingFinishCard: reschedules and cancellations", () => {
  it("a reschedule of an appointment already on the calendar offers Review Change, and applies it to that event only when saved", async () => {
    const { svc } = setup();
    const first = cand("m1", "See you Tuesday at 3 PM");
    await addEmailMeetingOnce({ scheduleSvc: svc, candidate: first, threadId: "t1", account: ME, zone: NY });
    resetEmailScheduleState();
    const moved = cand("m2", "Sorry, can we move it to Wednesday at 4 PM?", "agreed", "Practice", "2026-09-21");
    renderCard(svc, [first, moved]);
    await screen.findByRole("button", { name: "Review Change" });
    expect(screen.getByText("Rescheduled")).toBeInTheDocument();
    // Nothing was changed by looking.
    expect((await svc.listEvents())[0]!.data).toMatchObject({ date: "2026-09-22", start: "15:00" });
    fireEvent.click(screen.getByRole("button", { name: "Review Change" }));
    expect(await screen.findByText("Edit Event")).toBeInTheDocument();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-09-23");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("16:00");
    // Still not applied until Save.
    expect((await svc.listEvents())[0]!.data.start).toBe("15:00");
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText("On Your Calendar");
    const evs = await svc.listEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0]!.data).toMatchObject({ date: "2026-09-23", start: "16:00" });
  });

  it("an unfiled reschedule supersedes the earlier time: only the new one is offered", () => {
    const { svc } = setup();
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM"), cand("m2", "Actually let's move it to Wednesday at 4 PM")]);
    expect(screen.getAllByRole("button", { name: "Add to Calendar" })).toHaveLength(1);
    expect(screen.getByText("4:00 PM")).toBeInTheDocument();
    expect(screen.queryByText("3:00 PM")).not.toBeInTheDocument();
  });

  it("a cancellation removes the offer for an appointment that was never added", () => {
    const { svc } = setup();
    const r = renderCard(svc, [cand("m1", "See you Tuesday at 3 PM"), cand("m2", "I have to cancel Tuesday", "cancelled")]);
    expect(r.container).toBeEmptyDOMElement();
  });

  it("a cancellation of an appointment already on the calendar deletes NOTHING: it says so and offers a review", async () => {
    const { svc } = setup();
    const first = cand("m1", "See you Tuesday at 3 PM");
    await addEmailMeetingOnce({ scheduleSvc: svc, candidate: first, threadId: "t1", account: ME, zone: NY });
    resetEmailScheduleState();
    const deletes = vi.spyOn(svc, "deleteEvent");
    renderCard(svc, [first, cand("m2", "I have to cancel Tuesday", "cancelled")]);
    await screen.findByText("Cancelled");
    expect(screen.getByText("Still on Your Calendar")).toBeInTheDocument();
    expect(deletes).not.toHaveBeenCalled();
    expect(await svc.listEvents()).toHaveLength(1);
    // Removing it is the person's own tap, in the sheet.
    fireEvent.click(screen.getByRole("button", { name: "Review Change" }));
    fireEvent.click(await screen.findByText("Delete Event"));
    await waitFor(() => expect(deletes).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await svc.listEvents()).toHaveLength(0));
  });
});

describe("MeetingFinishCard: reading is not writing", () => {
  it("mounting with several candidates makes no calendar write of any kind", async () => {
    const { svc } = setup();
    const create = vi.spyOn(svc, "createEvent");
    const del = vi.spyOn(svc, "deleteEvent");
    const move = vi.spyOn(svc, "moveDay");
    renderCard(svc, [cand("m1", "See you Tuesday at 3 PM"), cand("m2", "Thursday morning works", "agreed", "Photo Day")]);
    await new Promise((r) => setTimeout(r, 30));
    expect(create).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });
});
