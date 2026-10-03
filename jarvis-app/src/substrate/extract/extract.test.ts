// THE RULES, AGAINST THE CATALOG'S OWN EXAMPLES (IMPLEMENTATION-SPEC.md 10;
// prompt 06 "Verify before completing": the four approved fixture cards plus
// the plain Wei and promo rows with no cards; three examples per card type;
// missing currency, date and zone; a bill's date that must never become a
// task or an event; a flight's receipt and itinerary as two cards or none).
// Everything here is deterministic: the same text, the same cards, the same
// fingerprints, on every run.
import { describe, it, expect } from "vitest";
import { extractCandidates, fingerprintOf, EXTRACTOR_VERSION, type ExtractInput } from "./index";
import { findAmounts, readNumber } from "./money";
import { findDates, findTimes, instantOf, yearFor } from "./dates";
import { dropQuoted, dropSignature, sourceText } from "./text";
import type { BillPayload, EventPayload, ReceiptPayload, TaskPayload, WaitingPayload } from "../contracts";

const base: Omit<ExtractInput, "from_address" | "from_name" | "subject" | "body"> = {
  account_id: "acct-dave", message_id: "msg-1", account: "dave@example.test", internal_date: "2026-10-03T13:24:00Z", zone: "America/New_York",
};
const mail = (from_address: string, from_name: string, subject: string, body: string, extra: Partial<ExtractInput> = {}): ExtractInput => ({ ...base, from_address, from_name, subject, body, ...extra });
const kinds = (cards: ReturnType<typeof extractCandidates>) => cards.map((c) => c.kind);

describe("the four fixture cards, and the two rows with none", () => {
  it("Con Edison: a bill, $142.30 due Oct 15, every field from the email, nothing missing", () => {
    const cards = extractCandidates(mail("billing@conedison.test", "Con Edison", "Your October bill is ready", "Your October statement is ready.\n\nAmount due: USD 142.30\nDue date: October 15, 2026\n\nThank you for being a customer."));
    expect(kinds(cards)).toEqual(["bill"]);
    const b = cards[0]!.payload as BillPayload;
    expect(b).toMatchObject({ issuer: "Con Edison", amount: { minor_units: 14230, currency: "USD" }, due_date: "2026-10-15", no_due_date_confirmed: false });
    expect(cards[0]!.missing).toEqual([]);
    expect(cards[0]!.provenance.amount).toMatchObject({ source: "email" });
    expect(cards[0]!.provenance.due_date).toMatchObject({ source: "email" });
    expect(cards[0]!.provenance.issuer).toEqual({ source: "sender" });
    expect(cards[0]!.evidence_excerpt).toContain("Amount due: USD 142.30");
    expect(cards[0]!.extractor_version).toBe(EXTRACTOR_VERSION);
  });
  it("Coach Miller: a waiting card for the transcript, from the sender's own promise", () => {
    const cards = extractCandidates(mail("coach@example.test", "Coach Miller", "Re: Peña transcript", "Dave,\n\nI'll get Peña's transcript over to you once the school sends it to me.\n\nCoach Miller"));
    expect(kinds(cards)).toEqual(["waiting"]);
    const w = cards[0]!.payload as WaitingPayload;
    expect(w).toMatchObject({ title: "Peña's Transcript", waiting_for: "Peña's transcript", counterparty_display: "Coach Miller", follow_up_on: null });
  });
  it("Delta: a receipt, $284.10 paid Oct 2, and no event from a payment receipt", () => {
    const cards = extractCandidates(mail("receipts@delta.test", "Delta Air Lines", "Your payment receipt", "Payment receipt\n\nTotal paid: USD 284.10\nPurchase date: October 2, 2026\n\nThis is your payment receipt, not your travel itinerary."));
    expect(kinds(cards)).toEqual(["receipt"]);
    const r = cards[0]!.payload as ReceiptPayload;
    expect(r).toMatchObject({ merchant: "Delta Air Lines", amount: { minor_units: 28410, currency: "USD" }, purchase_date: "2026-10-02", transaction_type: "purchase" });
  });
  it("Mrs. Rodriguez: an event, Oct 4 at 10 AM Eastern for fifteen minutes, in America/New_York", () => {
    const cards = extractCandidates(mail("rodriguez@example.test", "Mrs. Rodriguez", "Quick call about the deposit?", "Hi Dave,\n\nCould we have a quick call about the deposit on October 4 at 10 AM Eastern? Fifteen minutes should be enough.\n\nThank you!"));
    expect(kinds(cards)).toEqual(["event"]);
    const e = cards[0]!.payload as EventPayload;
    expect(e.title).toBe("Quick Call About the Deposit");
    expect(e.time).toEqual({ all_day: false, start_at: "2026-10-04T14:00:00.000Z", end_at: "2026-10-04T14:15:00.000Z", timezone: "America/New_York", selected_offset: "-04:00" });
    expect(cards[0]!.missing).toEqual([]);
    expect(cards[0]!.provenance.duration).toMatchObject({ source: "email" });
  });
  it("Wei's summary and the promo make no card at all", () => {
    expect(extractCandidates(mail("wei@example.test", "Wei Chang", "September expense summary", "Dave,\n\nThe updated September expense summary is attached for your review.\n\nWei"))).toEqual([]);
    expect(extractCandidates(mail("promos@dicks.test", "Dick's Sporting Goods", "A fresh start for your season", "Explore this week's gear and team equipment. No action is required."))).toEqual([]);
  });
});

describe("three of each", () => {
  it("bills: a facility invoice, a tournament balance, a statement with a symbol and no currency (asks)", () => {
    const facility = extractCandidates(mail("ar@facility.test", "Northside Facility", "Invoice 4021", "Invoice #4021\nAmount due: $750.00 USD\nDue: November 1, 2026"));
    expect(facility[0]!.payload).toMatchObject({ kind: "bill", amount: { minor_units: 75000, currency: "USD" }, due_date: "2026-11-01", invoice_number: "4021" });
    const tournament = extractCandidates(mail("admin@league.test", "Spring League", "Tournament balance", "Your tournament balance of USD 1,200.00 is due by May 15."));
    expect(tournament[0]!.payload).toMatchObject({ kind: "bill", amount: { minor_units: 120000, currency: "USD" }, due_date: "2027-05-15" });
    const symbol = extractCandidates(mail("billing@water.test", "City Water", "Your bill", "Amount due: $88.10\nPlease pay by October 20."));
    expect(symbol[0]!.payload).toMatchObject({ kind: "bill", amount: { minor_units: 8810, currency: "" }, due_date: "2026-10-20" });
    expect(symbol[0]!.missing).toEqual(["currency"]);
  });
  it("receipts: a hotel, equipment with the message date, a refund kept as a refund", () => {
    const hotel = extractCandidates(mail("stay@hotel.test", "Team Hotel", "Receipt for your stay", "Thank you for your payment.\nTotal paid: USD 620.00\nDate: September 30, 2026"));
    expect(hotel[0]!.payload).toMatchObject({ kind: "receipt", amount: { minor_units: 62000, currency: "USD" }, purchase_date: "2026-09-30" });
    const gear = extractCandidates(mail("orders@gear.test", "Gear Co", "Order confirmation", "Thanks for your order! You paid USD 87.45."));
    expect(gear[0]!.payload).toMatchObject({ kind: "receipt", amount: { minor_units: 8745 }, purchase_date: "2026-10-03" });
    expect(gear[0]!.provenance.purchase_date).toEqual({ source: "message_date", structured_path: "message.internal_date" });
    const refund = extractCandidates(mail("orders@gear.test", "Gear Co", "Your refund", "Your refund of USD 20.00 was issued on October 1, 2026."));
    expect(refund[0]!.payload).toMatchObject({ kind: "receipt", transaction_type: "refund", amount: { minor_units: 2000 } });
  });
  it("tasks: a transcript review by Oct 9, a roster by Oct 12, a headcount with no deadline", () => {
    const t1 = extractCandidates(mail("coach@example.test", "Coach Miller", "Transcript", "Can you review the Peña transcript by October 9?"))[0]!;
    expect(t1.payload).toMatchObject({ kind: "task", title: "Review the Peña Transcript", due_date: "2026-10-09", notes: "" });
    const t2 = extractCandidates(mail("admin@school.test", "Registrar", "Roster", "Please submit the scholarship roster by October 12, 2026."))[0]!;
    expect(t2.payload).toMatchObject({ kind: "task", title: "Submit the Scholarship Roster", due_date: "2026-10-12" });
    const t3 = extractCandidates(mail("parent@example.test", "Jamie Lee", "Practice", "Could you confirm the practice headcount?"))[0]!;
    expect(t3.payload).toMatchObject({ kind: "task", title: "Confirm the Practice Headcount", due_date: null });
    expect(t3.missing).toEqual([]);
    expect(t3.provenance.due_date).toMatchObject({ source: "default" });
  });
  it("events: an advisor meeting, a practice with a range, an ICS", () => {
    const advisor = extractCandidates(mail("advisor@example.test", "Pat Advisor", "Meeting", "Our advisor meeting is on October 8 at 6:00 PM ET for an hour."))[0]!;
    expect(advisor.payload).toMatchObject({ kind: "event", title: "Advisor Meeting", time: { start_at: "2026-10-08T22:00:00.000Z", end_at: "2026-10-08T23:00:00.000Z", timezone: "America/New_York" } });
    const practice = extractCandidates(mail("coach@example.test", "Coach Miller", "Practice", "Practice on October 10 from 2:00 PM to 4:00 PM Eastern at the north field."))[0]!;
    expect(practice.payload).toMatchObject({ kind: "event", title: "Practice", time: { start_at: "2026-10-10T18:00:00.000Z", end_at: "2026-10-10T20:00:00.000Z" } });
    const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:abc-123", "SUMMARY:Deposit call", "DTSTART;TZID=America/New_York:20261004T100000", "DTEND;TZID=America/New_York:20261004T101500", "END:VEVENT", "END:VCALENDAR"].join("\n");
    const fromIcs = extractCandidates(mail("rodriguez@example.test", "Mrs. Rodriguez", "Invitation", ics))[0]!;
    expect(fromIcs.payload).toMatchObject({ kind: "event", title: "Deposit Call", external_uid: "abc-123", time: { start_at: "2026-10-04T14:00:00.000Z", end_at: "2026-10-04T14:15:00.000Z" } });
    expect(fromIcs.template).toBe("event.ics");
  });
  it("waiting: a rooming list, a signed agreement, a promise with a date", () => {
    const list = extractCandidates(mail("sam@hotel.test", "Sam at the Hotel", "Rooming list", "I will send the rooming list over to you tomorrow."))[0]!;
    // A machine's promise is no promise: the same words from a bulk address make no card.
    expect(extractCandidates(mail("events@hotel.test", "Hotel Events", "Rooming list", "I will send the rooming list over to you tomorrow."))).toEqual([]);
    expect(list.payload).toMatchObject({ kind: "waiting", title: "Rooming List", counterparty_display: "Sam at the Hotel", follow_up_on: null });
    const signed = extractCandidates(mail("parent@example.test", "Alex Parent", "Scholarship", "We'll forward the signed scholarship agreement by October 7."))[0]!;
    expect(signed.payload).toMatchObject({ kind: "waiting", title: "Signed Scholarship Agreement", follow_up_on: "2026-10-07" });
    const own = extractCandidates(mail("dave@example.test", "Dave", "Re: list", "I'll send you the list tomorrow."));
    expect(own).toEqual([]);
  });
});

describe("what the rules refuse", () => {
  it("a bill's 'please pay by' never becomes a task, and its due date never becomes an event", () => {
    const cards = extractCandidates(mail("billing@conedison.test", "Con Edison", "Your bill", "Amount due: USD 142.30\nPlease pay by October 15, 2026.\nYour service appointment call is on October 15, 2026 at 9:00 AM ET."));
    expect(kinds(cards)).toContain("bill");
    expect(kinds(cards)).not.toContain("task");
    // The meeting on the same day is its own explicit evidence and stays.
    expect(kinds(cards)).toContain("event");
  });
  it("a separate explicit request in a bill's mail is its own task only with its own evidence", () => {
    const cards = extractCandidates(mail("billing@conedison.test", "Con Edison", "Your bill", "Amount due: USD 142.30 by October 15, 2026.\n\nCan you update your mailing address by October 30?"));
    expect(kinds(cards)).toEqual(["bill", "task"]);
    expect((cards[1]!.payload as TaskPayload).title).toBe("Update Your Mailing Address");
  });
  it("a casual mention is not a task; a request to pay is not a task", () => {
    expect(extractCandidates(mail("a@b.test", "A", "Hi", "We should review the roster at some point."))).toEqual([]);
    expect(extractCandidates(mail("a@b.test", "A", "Hi", "Please pay the invoice by Friday."))).not.toContainEqual(expect.objectContaining({ kind: "task" }));
  });
  it("a relative date asks instead of deciding; an ambiguous slash date asks; a bare symbol asks for the currency", () => {
    const rel = extractCandidates(mail("coach@example.test", "Coach Miller", "Transcript", "Can you review the transcript by tomorrow?"))[0]!;
    expect(rel.missing).toEqual(["due_date"]);
    expect(rel.provenance.due_date).toMatchObject({ note: "relative" });
    const slash = findDates("Due 03/04/2026", "2026-10-03")[0]!;
    expect(slash).toMatchObject({ iso: null, ambiguous: true });
    expect(findDates("Due 13/04/2026", "2026-10-03")[0]!.iso).toBe("2026-04-13");
    const amt = findAmounts("Total $42.00")[0]!;
    expect(amt).toMatchObject({ minor_units: 4200, currency: null });
  });
  it("a missing zone asks; a clock that happens twice asks for the offset; a clock that does not exist blocks", () => {
    const nozone = extractCandidates(mail("a@b.test", "Pat", "Call", "Let's have a call on October 8 at 3 PM."))[0]!;
    expect(nozone.missing).toContain("timezone");
    expect(instantOf("2026-11-01", 1, 30, "America/New_York")).toMatchObject({ ok: false, why: "ambiguous", offsets: ["-04:00", "-05:00"] });
    expect(instantOf("2026-11-01", 1, 30, "America/New_York", "-05:00")).toMatchObject({ ok: true, iso: "2026-11-01T06:30:00.000Z" });
    expect(instantOf("2026-03-08", 2, 30, "America/New_York")).toMatchObject({ ok: false, why: "nonexistent" });
    expect(instantOf("2026-10-04", 10, 0, "Not/AZone")).toMatchObject({ ok: false, why: "zone" });
  });
  it("a flight itinerary is an event and a flight receipt is a receipt; neither makes the other", () => {
    const itin = extractCandidates(mail("itinerary@airline.test", "Airline", "Your itinerary", "Flight DEN to SEA departs October 12 at 7:15 AM MT. Confirmation ABC123."));
    expect(kinds(itin)).toEqual(["event"]);
    expect((itin[0]!.payload as EventPayload).title).toBe("Flight DEN to SEA");
    const receipt = extractCandidates(mail("receipts@airline.test", "Airline", "Payment receipt", "Total paid: USD 284.10 on October 2, 2026 for your flight."));
    expect(kinds(receipt)).toEqual(["receipt"]);
  });
  it("quoted history and the signature are not read", () => {
    const text = sourceText("Re: bill", "Thanks!\n\nOn Oct 1, 2026, Con Edison wrote:\n> Amount due: USD 142.30\n> Due date: October 15, 2026");
    expect(text).not.toContain("142.30");
    expect(dropQuoted("Hello\n> quoted")).toBe("Hello\n");
    expect(dropSignature("Body here\n-- \nDave\n555-1234")).toBe("Body here\n");
    expect(extractCandidates(mail("coach@example.test", "Coach Miller", "Re: bill", "Thanks!\n\nOn Oct 1, 2026, Con Edison wrote:\n> Amount due: USD 142.30"))).toEqual([]);
  });
});

describe("numbers and dates, read without guessing", () => {
  it("minor units never pass through a float; the ambiguous shapes ask", () => {
    expect(readNumber("142.30")).toEqual({ minor_units: 14230, ambiguous: false });
    expect(readNumber("1,234.56")).toEqual({ minor_units: 123456, ambiguous: false });
    expect(readNumber("1.234,56")).toEqual({ minor_units: 123456, ambiguous: false });
    expect(readNumber("142,30")).toEqual({ minor_units: 14230, ambiguous: false });
    expect(readNumber("1,234")).toEqual({ minor_units: null, ambiguous: true });
    expect(readNumber("0.1")).toEqual({ minor_units: 10, ambiguous: false });
    expect(readNumber("0")).toEqual({ minor_units: null, ambiguous: true });
  });
  it("a year the text left out is the message's, or the next one when the date would be far behind", () => {
    expect(yearFor(10, 15, "2026-10-03")).toBe(2026);
    expect(yearFor(5, 15, "2026-10-03")).toBe(2027);
    expect(yearFor(9, 1, "2026-10-03")).toBe(2026);
  });
  it("times read AM and PM, ranges and zones, and a bare number is not a clock", () => {
    const t = findTimes("on October 4 at 10 AM Eastern, then 2:00 PM to 4:00 PM ET")!;
    expect(t[0]).toMatchObject({ hh: 10, mm: 0, zone: "America/New_York" });
    expect(t[1]).toMatchObject({ hh: 14, mm: 0, endHH: 16, endMM: 0 });
    expect(findTimes("Invoice 4021 for 2026")).toEqual([]);
  });
  it("the same message reads to the same fingerprints; a changed amount is a different card", () => {
    const a = extractCandidates(mail("billing@conedison.test", "Con Edison", "Bill", "Amount due: USD 142.30\nDue date: October 15, 2026"))[0]!;
    const b = extractCandidates(mail("billing@conedison.test", "Con Edison", "Bill", "Amount due: USD 142.30\nDue date: October 15, 2026"))[0]!;
    const c = extractCandidates(mail("billing@conedison.test", "Con Edison", "Bill", "Amount due: USD 148.20\nDue date: October 15, 2026"))[0]!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(fingerprintOf("acct", "m", "bill", { a: 1 })).toMatch(/^fp1:[0-9a-z]+$/);
  });
});
