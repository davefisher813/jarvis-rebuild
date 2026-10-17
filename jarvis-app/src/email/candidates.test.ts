// THE LINES A CARD DRAWS, AND WHAT THE LIST MAY READ INTO ONE (issue 112,
// populated Conversations, Schedule and Money; Dave 2026-10-13). Pure, no DOM:
//   - an event's day is the day in the zone its clock is printed in, so an
//     evening event is not labelled a day late, whatever zone the phone is in;
//   - an event's clock is 12-hour with AM or PM whatever the phone's own
//     locale says;
//   - an amount groups its thousands, and an amount that is not one says the
//     Amount is needed like every other field the card is waiting for;
//   - the list reads a row for a calendar event and for nothing else (spec
//     5.2, AC11): the bill, receipt, task and waiting readings are hidden, not
//     deleted, behind one constant.
import { describe, it, expect, afterEach, vi } from "vitest";
import { BODY_READ_KINDS, LIST_ROW_KINDS, bodyProposals, bodyReadingKey, cardLines, isPastEvent, listReadingKey, listRowProposals, localCandidate, readWithRules } from "./candidates";
import { readingKey } from "../substrate/extract";
import type { InboxRow } from "./emailClient";

const NOW = new Date("2026-10-03T15:00:00Z");

const event = (start_at: string, end_at: string, timezone: string) => ({
  kind: "event", title: "Dinner", location: null, external_uid: null,
  time: { all_day: false, start_at, end_at, timezone, selected_offset: "" },
}) as never;
// A narrow no-break space between the time and AM or PM (some engines write one) is a space to the reader.
const facts = (payload: never, now: Date = NOW) => cardLines({ payload }, now).facts.map((f) => f.text.replace(/\u202f/g, " "));

/** Runs `body` with the process in another zone, the way the repo's other zone tests do, and puts the zone back. */
function inZone(zone: string, body: () => void): void {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try { body(); } finally { if (before === undefined) delete process.env.TZ; else process.env.TZ = before; }
}

afterEach(() => { vi.restoreAllMocks(); });

describe("an event's day is the day in its own zone (G1)", () => {
  // 10:00 PM Eastern on Oct 6 is 02:00 on Oct 7 in UTC. The day fact used to read the UTC date off the front of the
  // instant and said "Oct 7" beside "10:00 PM", Eastern: every evening event a day late.
  const EVENING = event("2026-10-07T02:00:00.000Z", "2026-10-07T03:00:00.000Z", "America/New_York");

  it.each(["UTC", "America/New_York", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Pago_Pago"])("an evening event reads Oct 6 beside 10:00 PM to 11:00 PM and Eastern when the phone is in %s", (zone) => {
    inZone(zone, () => {
      expect(facts(EVENING)).toEqual(["Oct 6", "10:00 PM to 11:00 PM", "Eastern"]);
    });
  });

  it("Today and Yesterday are decided in the event's zone too, not the phone's", () => {
    // It is 4:00 PM Oct 6 in New York; the dinner is at 10:00 PM the same evening there.
    const afternoon = new Date("2026-10-06T20:00:00Z");
    // And it is 11:00 AM on Oct 8 there; the earlier dinner at 4:00 PM on Oct 7 was yesterday.
    const nextMorning = new Date("2026-10-08T15:00:00Z");
    const yesterdays = event("2026-10-07T20:00:00.000Z", "2026-10-07T21:00:00.000Z", "America/New_York");
    for (const zone of ["UTC", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      inZone(zone, () => {
        expect(facts(EVENING, afternoon)[0]).toBe("Today");
        expect(facts(yesterdays, nextMorning)[0]).toBe("Yesterday");
        expect(facts(yesterdays, new Date("2026-10-09T15:00:00Z"))[0]).toBe("Oct 7");
      });
    }
  });

  it("a month and a year boundary read in the zone as well", () => {
    // 11:30 PM Pacific on Dec 31 is 07:30 on Jan 1 in UTC.
    expect(facts(event("2027-01-01T07:30:00.000Z", "2027-01-01T08:30:00.000Z", "America/Los_Angeles"), new Date("2026-12-20T12:00:00Z"))).toEqual(["Dec 31", "11:30 PM to 12:30 AM", "Pacific"]);
  });

  it("an all-day event keeps its date as written and says All Day", () => {
    const allDay = { kind: "event", title: "Columbus Day", location: null, external_uid: null, time: { all_day: true, start_date: "2026-10-12", end_date: "2026-10-13" } } as never;
    expect(facts(allDay)).toEqual(["Oct 12", "All Day"]);
  });

  it("a card with no zone says Zone is needed and still draws a day and a clock", () => {
    const bare = cardLines({ payload: event("2026-10-06T18:00:00.000Z", "2026-10-06T19:00:00.000Z", "") }, NOW);
    expect(bare.facts[0]).toEqual({ text: "Needs Zone", tone: "warn" });
    expect(bare.facts.length).toBe(3);
  });

  it("a zone this runtime does not know falls back to the phone's own day and clock, not an exception", () => {
    expect(() => cardLines({ payload: event("2026-10-06T18:00:00.000Z", "2026-10-06T19:00:00.000Z", "Not/AZone") }, NOW)).not.toThrow();
  });
});

describe("an event's clock is 12-hour whatever the phone's locale (G2)", () => {
  // A phone set to a 24-hour locale answers an unspecified locale in 24-hour: the old code asked for the default
  // locale ([]) and drew "22:00 to 23:00". The spy stands in for that phone.
  function phoneInBritain(): void {
    const real = Date.prototype.toLocaleTimeString;
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date, locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      const asked = locales === undefined || (Array.isArray(locales) && locales.length === 0);
      return real.call(this, asked ? "en-GB" : locales, options);
    });
  }

  it("a timed event reads 10:00 PM to 11:00 PM, never 22:00", () => {
    phoneInBritain();
    // The stand-in really is a 24-hour phone: asked for the default locale it answers in 24-hour.
    expect(new Date("2026-10-07T02:00:00Z").toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })).toBe("22:00");
    const [, span] = facts(event("2026-10-07T02:00:00.000Z", "2026-10-07T03:00:00.000Z", "America/New_York"));
    expect(span).toBe("10:00 PM to 11:00 PM");
    expect(span).not.toMatch(/\b\d{1,2}:\d{2}\b(?! [AP]M)/);
  });

  it("an event with no zone is 12-hour as well", () => {
    phoneInBritain();
    const texts = facts(event("2026-10-06T18:00:00.000Z", "2026-10-06T19:00:00.000Z", ""));
    expect(texts.find((t) => /to/.test(t))).toMatch(/^\d{1,2}:\d{2} [AP]M to \d{1,2}:\d{2} [AP]M$/);
  });
});

describe("an amount on a card (M1)", () => {
  const bill = (minor_units: number, currency: string, extra: Record<string, unknown> = {}) =>
    ({ kind: "bill", issuer: "Con Edison", amount: { minor_units, currency }, due_date: "2026-10-15", no_due_date_confirmed: false, ...extra }) as never;

  it("groups its thousands like the Money tab: $1,284.56, not $1284.56", () => {
    expect(cardLines({ payload: bill(128456, "USD") }, NOW).value).toBe("$1,284.56");
    expect(cardLines({ payload: bill(240000, "USD") }, NOW).value).toBe("$2,400.00");
    expect(cardLines({ payload: bill(100000, "EUR") }, NOW).value).toBe("EUR 1,000.00");
    expect(cardLines({ payload: bill(14230, "USD") }, NOW).value).toBe("$142.30");
  });

  it("a number the rules could read without its currency groups too, and asks for the currency", () => {
    const c = cardLines({ payload: bill(128456, "") }, NOW);
    expect(c.value).toBe("1,284.56");
    expect(c.facts[0]).toEqual({ text: "Needs Currency", tone: "warn" });
  });

  it("an amount of zero or below says Amount Needed and names the Amount among the needs, in the one amber fact", () => {
    for (const cents of [0, -4800]) {
      const c = cardLines({ payload: bill(cents, "USD", { due_date: null }) }, NOW);
      expect(c.value).toBe("Amount Needed");
      expect(c.facts[0]).toEqual({ text: "Needs Amount, Due Date", tone: "warn" });
      expect(c.facts.filter((f) => f.tone === "warn")).toHaveLength(1);
    }
    // A receipt is the same card: the amount is a need beside the others.
    const r = cardLines({ payload: { kind: "receipt", merchant: "Lowe's", amount: { minor_units: -2500, currency: "USD" }, purchase_date: "2026-10-03", transaction_type: "refund" } as never }, NOW);
    expect(r.value).toBe("Amount Needed");
    expect(r.facts[0]).toEqual({ text: "Needs Amount", tone: "warn" });
  });

  it("a real amount asks for nothing it already has", () => {
    expect(cardLines({ payload: bill(128456, "USD") }, NOW).facts.map((f) => f.text)).toEqual(["Due Oct 15", "Con Edison"]);
  });
});

describe("the list reads a row for a calendar event and for nothing else (spec 5.2, AC11)", () => {
  const row = (o: Partial<InboxRow>): InboxRow => ({
    id: "u-1", account_id: "acct-dave", account: "dave@example.test", provider_id: "p1", thread_id: "t1", internal_date: "2026-10-03T12:00:00Z", from_address: "x@example.test", from_name: "X",
    subject: "", snippet: "", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh-1", read: true, ...o,
  });
  // Bait: rows whose words the rules DO read into a bill, a receipt, a task and a waiting card. If the rules stop reading
  // them these controls fail, so the proof below is never an empty one.
  const BILL = row({ from_name: "Con Edison", from_address: "billing@conedison.test", subject: "Your October bill is ready", snippet: "Your statement is ready. Amount due: USD 142.30. Due date: October 15, 2026." });
  const RECEIPT = row({ from_name: "Apple", from_address: "no_reply@email.apple.com", subject: "Your receipt from Apple.", snippet: "Receipt Order ID: ML7Q Total paid USD 9.99 on October 3, 2026. Thank you for your purchase." });
  const TASK = row({ from_name: "Wei Chang", from_address: "wei@example.test", subject: "Mailing address", snippet: "Can you update your mailing address by October 30?" });
  const WAITING = row({ from_name: "Coach Miller", from_address: "coach@example.test", subject: "Re: Transcript", snippet: "I'll get the transcript over to you once the school sends it to me." });
  const EVENT = row({ from_name: "Pat Advisor", from_address: "advisor@example.test", subject: "Meeting", snippet: "Our advisor meeting is on October 8 at 6:00 PM ET for an hour." });
  const kinds = (r: InboxRow, list: boolean) => (list ? listRowProposals(readWithRules(r, "America/New_York"), NOW) : readWithRules(r, "America/New_York")).map((p) => p.kind);

  it("the rules still read bill, receipt, task, waiting and event from the same words (the templates are hidden, not deleted)", () => {
    expect(kinds(BILL, false)).toContain("bill");
    expect(kinds(RECEIPT, false)).toContain("receipt");
    expect(kinds(TASK, false)).toContain("task");
    expect(kinds(WAITING, false)).toContain("waiting");
    expect(kinds(EVENT, false)).toContain("event");
  });

  it("the list keeps the event and drops the rest", () => {
    expect(LIST_ROW_KINDS).toEqual(["event"]);
    expect(kinds(BILL, true)).toEqual([]);
    expect(kinds(RECEIPT, true)).toEqual([]);
    expect(kinds(TASK, true)).toEqual([]);
    expect(kinds(WAITING, true)).toEqual([]);
    expect(kinds(EVENT, true)).toEqual(["event"]);
  });

  it("an opened message or Find Useful Details is not a list reading: readWithRules over a body still makes every kind", () => {
    const body = "Amount due: USD 142.30 by October 15, 2026. Can you update your mailing address by October 30?";
    expect(readWithRules(BILL, "America/New_York", body).map((p) => p.kind)).toEqual(expect.arrayContaining(["bill", "task"]));
  });

  it("an opened message, and Find Useful Details, read a bill, a receipt and an event, and never a task or a Waiting (AC11)", () => {
    const body = (r: InboxRow) => bodyProposals(readWithRules(r, "America/New_York", r.snippet), NOW).map((p) => p.kind);
    expect(BODY_READ_KINDS).toEqual(["bill", "receipt", "event"]);
    expect(body(BILL)).toContain("bill");
    expect(body(RECEIPT)).toContain("receipt");
    expect(body(EVENT)).toContain("event");
    expect(body(TASK)).toEqual([]);
    expect(body(WAITING)).toEqual([]);
    // the bait that makes a bill and a task at once makes only the bill
    const both = "Amount due: USD 142.30 by October 15, 2026. Can you update your mailing address by October 30?";
    expect(readWithRules(BILL, "America/New_York", both).map((p) => p.kind)).toEqual(expect.arrayContaining(["bill", "task"]));
    expect(bodyProposals(readWithRules(BILL, "America/New_York", both), NOW).map((p) => p.kind)).toEqual(["bill"]);
  });

  it("a body reading is remembered under a key that names the kinds read, so turning a kind back on reads the message again", () => {
    const plain = readingKey("acct-dave", "u-1", "sh-1");
    const body = bodyReadingKey("acct-dave", "u-1", "sh-1");
    expect(body).not.toBe(plain + ":body");
    expect(body.startsWith(plain + ":body:")).toBe(true);
    expect(body.endsWith(BODY_READ_KINDS.join(","))).toBe(true);
  });

  it("a list reading is remembered under its own key, which names the kinds read, so turning a kind back on reads the rows again", () => {
    const plain = readingKey("acct-dave", "u-1", "sh-1");
    const listed = listReadingKey("acct-dave", "u-1", "sh-1");
    expect(listed).not.toBe(plain);
    expect(listed.startsWith(plain)).toBe(true);
    expect(listed.endsWith(LIST_ROW_KINDS.join(","))).toBe(true);
  });
});

const pastRow = (o: Partial<InboxRow>): InboxRow => ({ id: "m-x", account_id: "a1", account: "dave@example.test", provider_id: "p", thread_id: "t", internal_date: "2026-10-03T12:00:00Z", from_address: "", from_name: "", subject: "", snippet: "", has_body: false, attachment_metadata: [], provider_labels: [], source_hash: "h-x", read: false, ...o } as InboxRow);

// A PAST EVENT IS NOT A PROPOSAL (2026-10-17: a June 10, 2025 invitation proposed again).
describe("isPastEvent", () => {
  const timed = (start: string, end: string) => ({ kind: "event" as const, title: "Call", location: null, external_uid: null, time: { all_day: false as const, start_at: start, end_at: end, timezone: "America/New_York", selected_offset: "" } });
  it("a timed event whose end has passed is past; one still ahead, or under way, is not", () => {
    expect(isPastEvent(timed("2025-06-10T14:00:00Z", "2025-06-10T15:00:00Z"), NOW)).toBe(true);
    expect(isPastEvent(timed("2026-10-03T14:30:00Z", "2026-10-03T15:30:00Z"), NOW)).toBe(false);
    expect(isPastEvent(timed("2026-10-16T22:00:00Z", "2026-10-16T22:30:00Z"), NOW)).toBe(false);
  });
  it("an all-day event is past once its last day is over; a bill or a task is never past", () => {
    const allDay = (start: string, endX: string) => ({ kind: "event" as const, title: "Fair", location: null, external_uid: null, time: { all_day: true as const, start_date: start, end_date_exclusive: endX } });
    expect(isPastEvent(allDay("2026-10-02", "2026-10-03"), NOW)).toBe(true);
    expect(isPastEvent(allDay("2026-10-03", "2026-10-04"), NOW)).toBe(false);
    expect(isPastEvent({ kind: "task", title: "Old", due_date: "2025-01-01", notes: "" }, NOW)).toBe(false);
  });
  it("the list and the body drop a past event and keep one ahead", () => {
    const old = pastRow({ from_name: "Pat Advisor", from_address: "advisor@example.test", subject: "Meeting", snippet: "Our advisor meeting is on June 10, 2025 at 6:00 PM ET.", internal_date: "2025-06-01T12:00:00Z" });
    expect(listRowProposals(readWithRules(old, "America/New_York"), NOW)).toEqual([]);
    expect(bodyProposals(readWithRules(old, "America/New_York", old.snippet), NOW)).toEqual([]);
  });
});

describe("localCandidate (a manual capture before it is saved)", () => {
  it("lives on this phone only: a local id, no revision, needs details, and the message's own hash", () => {
    const c = localCandidate("waiting", pastRow({ from_name: "Pat", from_address: "pat@example.test", subject: "Numbers", snippet: "Soon." }), { kind: "waiting", title: "", waiting_for: "", counterparty_display: "Pat", contact_id: null, follow_up_on: null }, ["title", "waiting_for"], NOW);
    expect(c.id.startsWith("local:")).toBe(true);
    expect(c).toMatchObject({ kind: "waiting", origin: "manual", status: "needs_details", revision: 0, missing_fields: ["title", "waiting_for"], message_id: "m-x", source_hash: "h-x", message_source_hash: "h-x" });
  });
});
