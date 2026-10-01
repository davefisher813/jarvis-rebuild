import { describe, it, expect, beforeEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "./ScheduleService";
import { dedupeEvents, twinsToHeal, findTwin, titlesAlike, isDoorMade } from "./eventTwins";
import { importCalendar } from "../connections/google/sync";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { addEmailMeetingOnce, findFiledMeeting, resetEmailScheduleState } from "../messages/emailSchedule";
import type { MeetingCandidate } from "../messages/mailContracts";
import type { EventItem } from "./types";

// THE SCHEDULE AUDIT'S #3 (2026-10-01): "Phone Interview with Equinox" twice at
// 11:30 on Fri Oct 2. One appointment, two doors (the Google import and the
// email that announced it), each deduping against itself and neither against
// the other. Pinned here at the read boundary, at the write boundary of every
// door, and in the importer's self-healing sweep.

const DAY = "2026-10-02";
const ev = (id: string, data: Partial<EventItem["data"]>): EventItem => ({
  id, data: { title: "Phone Interview with Equinox", date: DAY, start: "11:30", end: "12:00", category: "", ...data } as EventItem["data"],
});

describe("dedupeEvents: the read boundary", () => {
  it("two identical events, one imported and one from the email offer, are drawn once", () => {
    const out = dedupeEvents([ev("g", { gcalId: "g1" }), ev("m", { clientId: "emailmtg_x", source: { type: "email", ref: "t1", ts: 1 } })]);
    expect(out.map((e) => e.id)).toEqual(["m"]);
  });

  it("two imports of the same appointment under different Google ids are drawn once", () => {
    expect(dedupeEvents([ev("a", { gcalId: "g1" }), ev("b", { gcalId: "g2" })])).toHaveLength(1);
  });

  it("case, spacing and edge punctuation do not make a new appointment; a different start does", () => {
    const out = dedupeEvents([ev("a", { gcalId: "g1" }), ev("b", { gcalId: "g2", title: "  phone interview  with equinox. " }), ev("c", { gcalId: "g3", start: "13:00" })]);
    expect(out.map((e) => e.id).sort()).toEqual(["a", "c"]);
  });

  it("two events he typed himself are NEVER twins: a deliberate copy is his to keep", () => {
    expect(dedupeEvents([ev("a", {}), ev("b", {})])).toHaveLength(2);
  });

  it("the copy with his work in it survives, whichever door made it", () => {
    const out = dedupeEvents([ev("a", { clientId: "c1" }), ev("b", { gcalId: "g1", category: "work" })]);
    expect(out.map((e) => e.id)).toEqual(["b"]);
  });

  it("a series is never a twin of a one-off", () => {
    expect(dedupeEvents([ev("a", { gcalId: "g1", recurrence: "weekly" }), ev("b", { gcalId: "g2", recurrence: "weekly" })])).toHaveLength(2);
  });

  it("the answer does not depend on read order", () => {
    const a = ev("a", { gcalId: "g1" }), b = ev("b", { clientId: "c" });
    expect(dedupeEvents([a, b]).map((e) => e.id)).toEqual(dedupeEvents([b, a]).map((e) => e.id));
  });
});

describe("twinsToHeal: only the importer's own redundant copy is ever deleted", () => {
  it("the Google copy goes when an email's row survives it", () => {
    expect(twinsToHeal([ev("g", { gcalId: "g1" }), ev("m", { clientId: "c" })])).toEqual(["g"]);
  });
  it("a Google copy he filed or worked on stays", () => {
    expect(twinsToHeal([ev("g", { gcalId: "g1", category: "work" }), ev("m", { clientId: "c" })])).toEqual([]);
  });
  it("an email's row, a booking and a typed event are hidden but never deleted", () => {
    expect(twinsToHeal([ev("m", { clientId: "c" }), ev("n", { source: { type: "gmail", ref: "t", ts: 1 } })])).toEqual([]);
  });
  it("a booking outranks the Google copy of the same hour", () => {
    expect(twinsToHeal([ev("g", { gcalId: "g1" }), ev("b", { bookingId: "bk" })])).toEqual(["g"]);
  });
});

describe("findTwin and titlesAlike: the write boundary", () => {
  it("strict by default: an exact title at the same start", () => {
    const items = [ev("a", {})];
    expect(findTwin(items, { title: "phone interview with equinox", date: DAY, start: "11:30" })?.id).toBe("a");
    expect(findTwin(items, { title: "Phone Interview", date: DAY, start: "11:30" })).toBeNull();
  });
  it("loose accepts an email subject for the organiser's longer title, but only at the same start", () => {
    const items = [ev("a", {})];
    expect(findTwin(items, { title: "Phone Interview", date: DAY, start: "11:30" }, true)?.id).toBe("a");
    expect(findTwin(items, { title: "Phone Interview", date: DAY, start: "12:30" }, true)).toBeNull();
  });
  it("a short title is not swallowed by a longer one", () => {
    expect(titlesAlike("Gym", "Gym with Sam and the team")).toBe(false);
  });
  it("what counts as a door", () => {
    expect(isDoorMade(ev("a", {}).data)).toBe(false);
    expect(isDoorMade(ev("a", { gcalId: "g" }).data)).toBe(true);
    expect(isDoorMade(ev("a", { source: { type: "gmail", ts: 1 } }).data)).toBe(true);
  });
});

describe("the doors, end to end through the real services", () => {
  beforeEach(() => resetEmailScheduleState());
  const svc = () => new ScheduleService(new Store(new InMemoryAdapter()), "u");
  const gcal = (id = "g1") => makeFakeGoogleApi({
    listUpcomingEvents: async () => [{ id, summary: "Phone Interview with Equinox", start: { dateTime: `${DAY}T11:30:00` }, end: { dateTime: `${DAY}T12:00:00` } }],
    listRecentMessages: async () => [],
  });
  const cand = (): MeetingCandidate => ({
    id: "mc_equinox", sourceMessageId: "m1", sourceQuote: "Friday at 11:30", title: "Phone Interview with Equinox", status: "agreed",
    date: DAY, start: "11:30", end: "12:00", missing: [], durationSource: "default",
  });
  const emailArgs = (s: ScheduleService) => ({ scheduleSvc: s, candidate: cand(), threadId: "t1", account: "dave@me.com", zone: "America/New_York" });

  it("email first, then the Google import: the import does not write a second row", async () => {
    const s = svc();
    // The email's wall clock is read in the reader's zone; write the row the way the door does.
    await s.createEvent("Phone Interview with Equinox", { date: DAY, start: "11:30", end: "12:00", clientId: "emailmtg_x", source: { type: "email", ref: "t1", ts: 1 } });
    const r = await importCalendar(gcal(), s);
    expect(r.created).toBe(0);
    expect(await s.listEvents()).toHaveLength(1);
  });

  it("Google first, then the email offer: the offer says already, and writes nothing", async () => {
    const s = svc();
    await importCalendar(gcal(), s);
    expect(await s.listEvents()).toHaveLength(1);
    const found = await findFiledMeeting(s, { account: "dave@me.com", threadId: "t1", candidate: cand(), zone: "UTC" });
    expect(found).toBe((await s.listEvents())[0]!.id);
    const r = await addEmailMeetingOnce({ ...emailArgs(s), zone: "UTC" });
    expect(r.status).toBe("already");
    expect(await s.listEvents()).toHaveLength(1);
  });

  it("a double that already exists heals on the next import and renders once either way", async () => {
    const s = svc();
    await s.createEvent("Phone Interview with Equinox", { date: DAY, start: "11:30", end: "12:00", gcalId: "g1" });
    await s.createEvent("Phone Interview with Equinox", { date: DAY, start: "11:30", end: "12:00", clientId: "emailmtg_x", source: { type: "email", ref: "t1", ts: 1 } });
    // Read boundary first: what a tab draws, before any sweep has run.
    expect(await s.eventsOn(DAY)).toHaveLength(1);
    expect(await s.countOn(DAY)).toBe(1);
    expect((await s.listEvents())).toHaveLength(2);
    // The importer's own sweep takes the redundant Google copy, and keeps the email's.
    await importCalendar(gcal(), s);
    const left = await s.listEvents();
    expect(left).toHaveLength(1);
    expect(left[0]!.data.clientId).toBe("emailmtg_x");
  });

  it("healTwinEvents is the same sweep at the read boundary", async () => {
    const s = svc();
    await s.createEvent("Phone Interview with Equinox", { date: DAY, start: "11:30", gcalId: "g1" });
    await s.createEvent("Phone Interview with Equinox", { date: DAY, start: "11:30", bookingId: "bk1" });
    expect(await s.healTwinEvents()).toBe(1);
    expect((await s.listEvents())[0]!.data.bookingId).toBe("bk1");
    expect(await s.healTwinEvents()).toBe(0);
  });

  it("the same appointment read from two mailboxes stays two rows (per-mailbox identity) but is drawn once", async () => {
    const s = svc();
    await addEmailMeetingOnce({ ...emailArgs(s), zone: "UTC" });
    await addEmailMeetingOnce({ ...emailArgs(s), zone: "UTC", account: "other@x.com" });
    expect(await s.listEvents()).toHaveLength(2);
    expect(await s.eventsOn(DAY)).toHaveLength(1);
    expect(await s.healTwinEvents()).toBe(0);
  });

  it("two events he made himself, identical, are untouched by every layer", async () => {
    const s = svc();
    await s.createEvent("Coffee", { date: DAY, start: "09:00" });
    await s.createEvent("Coffee", { date: DAY, start: "09:00" });
    expect(await s.healTwinEvents()).toBe(0);
    expect(await s.eventsOn(DAY)).toHaveLength(2);
  });
});
