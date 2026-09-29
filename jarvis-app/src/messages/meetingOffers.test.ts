import { describe, it, expect } from "vitest";
import { meetingOffers, proposedFromBrief } from "./meetingOffers";
import { readWhen } from "./meetingRead";
import type { MeetingCandidate, MeetingStatus } from "./mailContracts";

// Built the way the brief builds them: the sentence is read by readWhen against
// the day the message was written, so these are the real required examples and
// not hand-typed shapes.
const DAYS: Record<string, string> = { m1: "2026-09-21", m2: "2026-09-21", m3: "2026-09-22", m4: "2026-09-23" };
let seq = 0;
function c(messageId: string, quote: string, status: MeetingStatus = "agreed", title = "Practice"): MeetingCandidate {
  const w = readWhen(quote, DAYS[messageId]!);
  const start = w.start;
  const end = start ? `${String(Math.min(23, Number(start.slice(0, 2)) + 1)).padStart(2, "0")}:${start.slice(3)}` : undefined;
  return {
    id: "mc_" + ++seq, sourceMessageId: messageId, sourceQuote: quote, title, status,
    ...(w.date ? { date: w.date } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}),
    ...(w.dayPart ? { dayPart: w.dayPart } : {}), missing: w.missing, durationSource: "default",
  };
}
const ORDER = ["m1", "m2", "m3", "m4"];
const TODAY = "2026-09-21";
const offers = (candidates: MeetingCandidate[], filed: Record<string, string> = {}, today = TODAY) =>
  meetingOffers({ candidates, order: ORDER, filed, today });

describe("the finish card's required examples", () => {
  it("See you Tuesday at 3 PM: one tap, Add", () => {
    const [o] = offers([c("m1", "See you Tuesday at 3 PM")]);
    expect(o).toMatchObject({ kind: "add", candidate: { date: "2026-09-22", start: "15:00" } });
  });

  it("Tuesday at 3: asks AM or PM, in the sender's own hour", () => {
    const [o] = offers([c("m1", "Tuesday at 3")]);
    expect(o).toMatchObject({ kind: "ask", ask: "meridiem", hour: { hour: 3, minute: 0 } });
    expect(o!.candidate.start).toBeUndefined();
  });

  it("Thursday morning: asks for a time, and never guesses 9 AM", () => {
    const [o] = offers([c("m1", "Thursday morning works")]);
    expect(o).toMatchObject({ kind: "ask", ask: "time" });
    expect(o!.candidate.start).toBeUndefined();
    expect(o!.candidate.dayPart).toBe("morning");
  });

  it("tomorrow at 10 resolves against the SOURCE message's day and asks for the meridiem", () => {
    // The message was written Monday the 21st: tomorrow is the 22nd, even if it is opened on the 25th.
    const [o] = offers([c("m1", "Tomorrow at 10?")], {}, "2026-09-21");
    expect(o).toMatchObject({ kind: "ask", ask: "meridiem", candidate: { date: "2026-09-22" } });
  });

  it("no day at all asks for the day", () => {
    const [o] = offers([c("m1", "Does 3 PM work for you")]);
    expect(o).toMatchObject({ kind: "ask", ask: "date" });
  });

  it("an ambiguous zone asks for the zone", () => {
    const [o] = offers([c("m1", "Tuesday at 3 PM CST")]);
    expect(o).toMatchObject({ kind: "ask", ask: "timezone" });
  });
});

describe("only an agreed time is offered", () => {
  it("proposals and requests are not offers, and alternatives stay proposals", () => {
    const list = [
      c("m1", "Could do Tuesday at 3 PM", "proposed"),
      c("m1", "or Wednesday at 10 AM", "proposed"),
      c("m1", "Can we meet Thursday at 2 PM?", "requested"),
    ];
    expect(offers(list)).toEqual([]);
  });

  it("the proposed-time flow reads them from the brief, with no second call", () => {
    const list = [
      c("m1", "Could do Tuesday at 3 PM", "proposed"),
      c("m1", "or Wednesday at 10 AM", "proposed"),
      c("m1", "Thursday morning also works", "proposed"), // no time: not a slot to check
      c("m1", "See you Friday at 1 PM", "agreed"),
    ];
    const p = proposedFromBrief(list);
    expect(p.map((x) => [x.date, x.start])).toEqual([["2026-09-22", "15:00"], ["2026-09-23", "10:00"]]);
    expect(p[0]!.label).toBe("Could do Tuesday at 3 PM");
  });
});

describe("the same time said twice is one appointment", () => {
  it("a later confirmation folds into the first, so the id the calendar was keyed by never changes", () => {
    const first = c("m1", "See you Tuesday at 3 PM");
    const again = c("m3", "Confirmed, Tuesday at 3 PM");
    // Both say the 22nd at 3 PM: m3 is written on the 22nd, where "Tuesday" is the 29th, so give it the same day.
    again.date = first.date; again.start = first.start; again.end = first.end;
    const out = offers([first, again]);
    expect(out).toHaveLength(1);
    expect(out[0]!.candidate.id).toBe(first.id);
  });
});

describe("a reschedule supersedes, and is reviewed, never applied", () => {
  const original = () => c("m1", "See you Tuesday at 3 PM");
  const moved = () => { const m = c("m3", "Sorry, can we move it to Wednesday at 4 PM? Confirmed"); return m; };

  it("unfiled: only the new time is offered, as an ordinary Add", () => {
    const a = original();
    const b = moved();
    const out = offers([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "add", candidate: { id: b.id, start: "16:00" } });
  });

  it("filed: the offer is Review Change, pointing at the event that is on the calendar", () => {
    const a = original();
    const b = moved();
    const out = offers([a, b], { [a.id]: "ev1" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "review_change", eventId: "ev1", candidate: { id: b.id }, from: { id: a.id } });
  });

  it("once the change is applied and linked, the new detection reads as filed on the same event", () => {
    const a = original();
    const b = moved();
    const out = offers([a, b], { [a.id]: "ev1", [b.id]: "ev1" });
    expect(out).toEqual([{ kind: "filed", candidate: b, eventId: "ev1" }]);
  });

  it("a change two steps back is still found: original filed, moved, then moved again", () => {
    const a = original();
    const b = c("m2", "Actually can we move to Wednesday at 4 PM");
    const d = c("m4", "Let's switch to Thursday at 9 AM instead");
    const out = offers([a, b, d], { [a.id]: "ev1" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "review_change", eventId: "ev1", candidate: { id: d.id } });
  });

  it("two different appointments in one thread are two offers", () => {
    const dentist = c("m1", "Your cleaning is Tuesday at 3 PM", "agreed", "Dental Cleaning");
    const photos = c("m2", "Photo day is Friday at 10 AM", "agreed", "Photo Day");
    expect(offers([dentist, photos]).map((o) => o.candidate.id)).toEqual([dentist.id, photos.id]);
  });

  it("a later agreed time about the same subject replaces the earlier even without change words", () => {
    const a = c("m1", "Dentist is Tuesday at 3 PM", "agreed", "Dentist Appointment");
    const b = c("m2", "Dentist is Friday at 10 AM", "agreed", "Dentist Appointment");
    expect(offers([a, b]).map((o) => o.candidate.id)).toEqual([b.id]);
  });

  it("generic titles need a change word to supersede: two plain 'Meeting's are two", () => {
    const a = c("m1", "Tuesday at 3 PM", "agreed", "Meeting");
    const b = c("m2", "Friday at 10 AM", "agreed", "Meeting");
    expect(offers([a, b])).toHaveLength(2);
    const moved2 = c("m2", "Let's reschedule for Friday at 10 AM", "agreed", "Meeting");
    expect(offers([a, moved2]).map((o) => o.candidate.id)).toEqual([moved2.id]);
  });
});

describe("a cancellation removes the offer and deletes nothing", () => {
  it("cancelled before it was ever added: no offer at all", () => {
    const a = c("m1", "See you Tuesday at 3 PM");
    const x = c("m3", "I have to cancel Tuesday", "cancelled");
    expect(offers([a, x])).toEqual([]);
  });

  it("cancelled after it was added: the event is reported, left on the calendar, with a door to review it", () => {
    const a = c("m1", "See you Tuesday at 3 PM");
    const x = c("m3", "I have to cancel Tuesday", "cancelled");
    const out = offers([a, x], { [a.id]: "ev1" });
    expect(out).toEqual([{ kind: "cancelled_filed", candidate: x, eventId: "ev1", from: a }]);
  });

  it("a cancellation of a different appointment leaves this one alone", () => {
    const dentist = c("m1", "Your cleaning is Tuesday at 3 PM", "agreed", "Dental Cleaning");
    const photos = c("m1", "Photo day is Friday at 10 AM", "agreed", "Photo Day");
    const x = c("m3", "Photo day is cancelled", "cancelled", "Photo Day");
    expect(offers([dentist, photos, x]).map((o) => o.candidate.id)).toEqual([dentist.id]);
  });

  it("rebooked after a cancellation: the new time is offered", () => {
    const a = c("m1", "See you Tuesday at 3 PM");
    const x = c("m2", "Cancel Tuesday", "cancelled");
    const b = c("m4", "New time: Friday at 10 AM");
    b.date = "2026-09-25";
    expect(offers([a, x, b]).map((o) => [o.kind, o.candidate.id])).toEqual([["add", b.id]]);
  });
});

describe("dates that have passed", () => {
  it("a day before today is not offered unless it is already filed", () => {
    const a = c("m1", "See you Tuesday at 3 PM");
    expect(offers([a], {}, "2026-09-30")).toEqual([]);
    expect(offers([a], { [a.id]: "ev1" }, "2026-09-30")[0]).toMatchObject({ kind: "filed" });
  });
});

describe("ordering", () => {
  it("candidates are ordered by the message that said them, not by the order they arrived in", () => {
    const a = c("m1", "Dentist is Tuesday at 3 PM", "agreed", "Dentist Appointment");
    const b = c("m3", "Dentist is Friday at 10 AM", "agreed", "Dentist Appointment");
    expect(offers([b, a]).map((o) => o.candidate.id)).toEqual([b.id]);
  });
});
