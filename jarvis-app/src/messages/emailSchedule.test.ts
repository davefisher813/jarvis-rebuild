import { describe, it, expect, beforeEach, vi } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "../schedule/ScheduleService";
import {
  addEmailMeetingOnce, findFiledMeeting, icsToCandidate, meetingClientId, missingLine, resetEmailScheduleState,
  reviseFiledMeeting, applyEventDraft, draftFromEvent, type EmailReviseSvc,
} from "./emailSchedule";
import type { MeetingCandidate } from "./mailContracts";
import { readIcs } from "./ics";

const NY = "America/New_York";
const ME = "dave@me.com";

const cand = (over: Partial<MeetingCandidate> = {}): MeetingCandidate => ({
  id: "mc_abc", sourceMessageId: "m3", sourceQuote: "See you Tuesday at 3 PM", title: "Practice", status: "agreed",
  date: "2026-09-22", start: "15:00", end: "16:00", missing: [], durationSource: "default", ...over,
});
const setup = () => {
  const store = new Store(new InMemoryAdapter());
  const svc = new ScheduleService(store, "u1");
  return { store, svc };
};
// The store behind a service, to watch what actually gets written.
const store = (svc: ScheduleService) => (svc as unknown as { store: Store }).store;
const args = (svc: EmailReviseSvc, c = cand(), over: Record<string, unknown> = {}) => ({
  scheduleSvc: svc, candidate: c, threadId: "t1", account: ME, zone: NY, ...over,
});

beforeEach(() => resetEmailScheduleState());

describe("addEmailMeetingOnce: the one door", () => {
  it("adds a complete appointment: title, day, start, default end, provenance and the idempotency key", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc));
    expect(r.status).toBe("added");
    expect(r.message).toMatch(/^Scheduled [A-Za-z]+ \d+, \d{1,2}:\d{2} [AP]M$/);
    expect(r.message, "one short line, no typed dot").not.toContain("\u00b7");
    const [ev] = await svc.listEvents();
    expect(ev!.data).toMatchObject({
      title: "Practice", date: "2026-09-22", start: "15:00", end: "16:00",
      source: { type: "email", ref: "t1" }, clientId: meetingClientId(ME, "mc_abc"),
    });
    expect((await svc.listEvents())).toHaveLength(1);
  });

  it("a title passed in overrides the candidate's", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc, cand(), { title: "Team Practice" }));
    expect((await svc.listEvents())[0]!.data.title).toBe("Team Practice");
  });

  it("two taps at once are one write, and both callers get the same answer", async () => {
    const { svc } = setup();
    const [a, b] = await Promise.all([addEmailMeetingOnce(args(svc)), addEmailMeetingOnce(args(svc))]);
    expect(a).toBe(b);
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("a tap after the first finished is 'already', with the same event, and writes nothing", async () => {
    const { svc } = setup();
    const first = await addEmailMeetingOnce(args(svc));
    const again = await addEmailMeetingOnce(args(svc));
    expect(again.status).toBe("already");
    expect(again.eventId).toBe(first.eventId);
    expect(again.undo).toBeUndefined();
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("a reload rebuilds the candidate from the cache and still finds the event", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc));
    resetEmailScheduleState(); // a fresh session: no in-flight state, nothing in memory
    const rebuilt = JSON.parse(JSON.stringify(cand())) as MeetingCandidate;
    expect((await addEmailMeetingOnce(args(svc, rebuilt))).status).toBe("already");
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("another device (a second service on the same account) finds it: already", async () => {
    const { store, svc } = setup();
    const other = new ScheduleService(store, "u1");
    await addEmailMeetingOnce(args(svc));
    resetEmailScheduleState();
    expect((await addEmailMeetingOnce(args(other))).status).toBe("already");
    expect(await other.listEvents()).toHaveLength(1);
  });

  it("two devices that BOTH miss the lookup still land as one row: the create itself is idempotent", async () => {
    const { store, svc } = setup();
    const other = new ScheduleService(store, "u1");
    // Neither device can see the other's write when it looks (a sync not yet arrived).
    const blind = (s: ScheduleService): EmailReviseSvc => Object.assign(Object.create(s), { listEvents: async () => [] }) as EmailReviseSvc;
    const a = addEmailMeetingOnce(args(blind(svc)));
    // A second device is a second app: it has no in-flight state of the first.
    resetEmailScheduleState();
    const b = addEmailMeetingOnce(args(blind(other)));
    const [ra, rb] = await Promise.all([a, b]);
    expect([ra.status, rb.status]).toEqual(["added", "added"]);
    expect(ra.eventId).toBe(rb.eventId);
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("two different appointments in one thread are two events", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc, cand({ id: "mc_one" })));
    await addEmailMeetingOnce(args(svc, cand({ id: "mc_two", date: "2026-09-24", start: "09:00", end: "10:00" })));
    expect(await svc.listEvents()).toHaveLength(2);
  });

  it("the same appointment id in another mailbox is its own event", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc));
    await addEmailMeetingOnce(args(svc, cand(), { account: "other@x.com" }));
    expect(await svc.listEvents()).toHaveLength(2);
  });

  it("recognises an event the old handler made: same thread, same day, same start, no key", async () => {
    const { svc } = setup();
    const { madeBy } = await import("../shared/provenance");
    await svc.createEvent("Practice", { date: "2026-09-22", start: "15:00", end: "16:00", source: madeBy("email", "t1") });
    expect((await addEmailMeetingOnce(args(svc))).status).toBe("already");
    expect(await svc.listEvents()).toHaveLength(1);
  });
});

describe("addEmailMeetingOnce: what it will not write", () => {
  it("an appointment missing AM or PM is incomplete, and nothing is written", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc, cand({ start: undefined, end: undefined, missing: ["meridiem"] })));
    expect(r).toMatchObject({ status: "incomplete", message: "Needs AM or PM" });
    expect(await svc.listEvents()).toHaveLength(0);
  });

  it("missing a day, a time or a zone: incomplete, in words", async () => {
    const { svc } = setup();
    expect((await addEmailMeetingOnce(args(svc, cand({ date: undefined, missing: ["date"] })))).message).toBe("Needs a Day");
    expect((await addEmailMeetingOnce(args(svc, cand({ start: undefined, end: undefined, missing: ["time"], dayPart: "morning" })))).message).toBe("Needs a Time");
    expect((await addEmailMeetingOnce(args(svc, cand({ missing: ["timezone"] })))).status).toBe("incomplete");
    expect(missingLine(["date", "time"])).toBe("Needs a Day and a Time");
    expect(missingLine(["date", "time", "timezone"])).toBe("Needs a Day, a Time and a Time Zone");
    expect(await svc.listEvents()).toHaveLength(0);
  });

  it("a cancelled appointment is never added", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc, cand({ status: "cancelled" })));
    expect(r.status).toBe("failed");
    expect(await svc.listEvents()).toHaveLength(0);
  });

  it("a wall clock that does not exist in its own zone is not written", async () => {
    const { svc } = setup();
    // 2:30 AM on 2026-03-08 does not exist in New York.
    const r = await addEmailMeetingOnce(args(svc, cand({ date: "2026-03-08", start: "02:30", end: "03:30", timeZone: NY }), { zone: "Europe/London" }));
    expect(r.status).toBe("incomplete");
    expect(await svc.listEvents()).toHaveLength(0);
  });
});

describe("addEmailMeetingOnce: zones", () => {
  it("a stated zone is converted to the reader's clock: Los Angeles 10:00 is 13:00 in New York", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc, cand({ start: "10:00", end: "11:00", timeZone: "America/Los_Angeles" })));
    expect((await svc.listEvents())[0]!.data).toMatchObject({ date: "2026-09-22", start: "13:00", end: "14:00" });
  });

  it("the day moves with the clock: Tokyo 8 AM is the evening before in New York", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc, cand({ start: "08:00", end: "09:00", timeZone: "Asia/Tokyo" })));
    expect((await svc.listEvents())[0]!.data).toMatchObject({ date: "2026-09-21", start: "19:00", end: "20:00" });
  });

  it("across daylight saving: the same sender clock lands an hour apart before and after the reader's change", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc, cand({ id: "a", date: "2026-10-30", start: "13:00", end: "14:00", timeZone: "Europe/London" })));
    await addEmailMeetingOnce(args(svc, cand({ id: "b", date: "2026-11-02", start: "13:00", end: "14:00", timeZone: "Europe/London" })));
    const evs = (await svc.listEvents()).sort((x, y) => x.data.date.localeCompare(y.data.date));
    // London left BST on Oct 25 and New York is still on EDT until Nov 1: 13:00 GMT is 9 AM EDT.
    // On Nov 2 both have changed: 13:00 GMT is 8 AM EST.
    expect(evs.map((e) => e.data.start)).toEqual(["09:00", "08:00"]);
  });

  it("an overnight candidate is kept to its own day: the end is the default, never past midnight", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc, cand({ start: "23:30", end: "23:59", durationSource: "default" })));
    expect((await svc.listEvents())[0]!.data).toMatchObject({ start: "23:30", end: "23:59" });
  });
});

describe("addEmailMeetingOnce: failures say so", () => {
  it("a create that throws is failed, with nothing saved", async () => {
    const { svc } = setup();
    const broken = Object.assign(Object.create(svc), { createEvent: async () => { throw new Error("offline"); } }) as EmailReviseSvc;
    const r = await addEmailMeetingOnce(args(broken));
    expect(r).toMatchObject({ status: "failed", message: "Couldn't Add It · Nothing Was Saved" });
    expect(await svc.listEvents()).toHaveLength(0);
    // And the in-flight guard is released: the next tap tries again.
    expect((await addEmailMeetingOnce(args(svc))).status).toBe("added");
  });

  it("a create that returns nothing is failed", async () => {
    const { svc } = setup();
    const broken = Object.assign(Object.create(svc), { createEvent: async () => null }) as EmailReviseSvc;
    expect((await addEmailMeetingOnce(args(broken))).status).toBe("failed");
  });

  it("a create whose row cannot be read back is not reported as added", async () => {
    const { svc } = setup();
    const ghost = Object.assign(Object.create(svc), { event: async () => null }) as EmailReviseSvc;
    const r = await addEmailMeetingOnce(args(ghost));
    expect(r.status).toBe("failed");
    expect(r.message).toContain("Check Your Calendar");
  });

  it("when the look-first read fails the create is still idempotent, and no Undo is offered for a row it may not have made", async () => {
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc));
    resetEmailScheduleState();
    const blind = Object.assign(Object.create(svc), { listEvents: async () => { throw new Error("read failed"); } }) as EmailReviseSvc;
    const r = await addEmailMeetingOnce(args(blind));
    expect(r.status).toBe("added");
    expect(r.undo).toBeUndefined();
    expect(await svc.listEvents()).toHaveLength(1);
  });
});

describe("addEmailMeetingOnce: Undo reports true only after a confirmed delete", () => {
  it("removes the row it made and says true once it is gone", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc));
    expect(await r.undo!()).toBe(true);
    expect(await svc.listEvents()).toHaveLength(0);
    // Adding again after an undo is allowed: the key went with the row.
    expect((await addEmailMeetingOnce(args(svc))).status).toBe("added");
  });

  it("a delete that throws is false, and the event is still there", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc));
    (svc as unknown as { deleteEvent: unknown }).deleteEvent = async () => { throw new Error("nope"); };
    expect(await r.undo!()).toBe(false);
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("a delete that 'succeeds' but leaves the row is false: unconfirmed is not deleted", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc));
    (svc as unknown as { deleteEvent: unknown }).deleteEvent = async () => undefined;
    expect(await r.undo!()).toBe(false);
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("does not delete a row that no longer carries this appointment's key", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc));
    const real = svc.event.bind(svc);
    (svc as unknown as { event: unknown }).event = async (id: string) => { const e = await real(id); return e ? { ...e, clientId: "someone-else" } : e; };
    expect(await r.undo!()).toBe(false);
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("two undo taps are one delete", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc));
    let deletes = 0;
    const real = svc.deleteEvent.bind(svc);
    (svc as unknown as { deleteEvent: unknown }).deleteEvent = async (id: string) => { deletes++; await real(id); };
    const [a, b] = await Promise.all([r.undo!(), r.undo!()]);
    expect([a, b]).toEqual([true, true]);
    expect(deletes).toBe(1);
  });

  it("undo after the event was already deleted elsewhere is true: it is gone", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc));
    await svc.deleteEvent(r.eventId!);
    expect(await r.undo!()).toBe(true);
  });
});

describe("findFiledMeeting and reviseFiledMeeting: a reschedule is reviewed, never applied on its own", () => {
  it("finding is read only", async () => {
    const { svc } = setup();
    expect(await findFiledMeeting(svc, { account: ME, threadId: "t1", candidate: cand(), zone: NY })).toBeNull();
    expect(await svc.listEvents()).toHaveLength(0);
  });

  it("an applied reschedule moves the event and answers for the new detection too", async () => {
    const { svc } = setup();
    const first = await addEmailMeetingOnce(args(svc, cand({ id: "mc_old" })));
    const newer = cand({ id: "mc_new", date: "2026-09-23", start: "10:00", end: "11:00" });
    // Before review: the new detection is not on the calendar.
    expect(await findFiledMeeting(svc, { account: ME, threadId: "t1", candidate: newer, zone: NY })).toBeNull();
    const ok = await reviseFiledMeeting(svc, first.eventId!, { title: "Practice", date: "2026-09-23", start: "10:00", end: "11:00" }, { account: ME, candidateId: "mc_new" });
    expect(ok).toBe(true);
    const [ev] = await svc.listEvents();
    expect(ev!.data).toMatchObject({ date: "2026-09-23", start: "10:00", end: "11:00" });
    // The original key is unchanged (the unique index keeps holding) and the new detection is linked.
    expect(ev!.data.clientId).toBe(meetingClientId(ME, "mc_old"));
    expect(await findFiledMeeting(svc, { account: ME, threadId: "t1", candidate: newer, zone: NY })).toBe(first.eventId);
    // So adding the new one is 'already', not a second event.
    expect((await addEmailMeetingOnce(args(svc, newer))).status).toBe("already");
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("a revise whose write throws is false", async () => {
    const { svc } = setup();
    const first = await addEmailMeetingOnce(args(svc));
    (svc as unknown as { moveDay: unknown }).moveDay = async () => { throw new Error("no"); };
    expect(await reviseFiledMeeting(svc, first.eventId!, { title: "Practice", date: "2026-09-25", start: "15:00", end: "16:00" }, { account: ME, candidateId: "x" })).toBe(false);
  });

  it("a revise of an event that is gone is false", async () => {
    const { svc } = setup();
    expect(await reviseFiledMeeting(svc, "nope", { title: "x", date: "2026-09-25", start: "15:00", end: "16:00" }, { account: ME, candidateId: "x" })).toBe(false);
  });
});

describe("icsToCandidate", () => {
  const ics = (extra: string, cal = "") => `BEGIN:VCALENDAR\r\n${cal}BEGIN:VEVENT\r\nSUMMARY:Review\r\n${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const read = (raw: string) => readIcs(raw, { zone: NY }).event!;
  const ctx = { account: ME, threadId: "t1", messageId: "m1" };

  it("an invitation in the reader's zone becomes a complete agreed candidate with the stated length", () => {
    const c = icsToCandidate(read(ics("UID:u1\r\nDTSTART:20260923T130000\r\nDTEND:20260923T133000")), ctx)!;
    expect(c).toMatchObject({ status: "agreed", date: "2026-09-23", start: "13:00", end: "13:30", missing: [], durationSource: "stated" });
    expect(c.timeZone).toBeUndefined();
  });

  it("a file with no length gets the default, labelled as one", () => {
    const c = icsToCandidate(read(ics("DTSTART:20260923T130000")), ctx)!;
    expect(c).toMatchObject({ end: "14:00", durationSource: "default" });
  });

  it("a foreign zone keeps the file's own clock and zone, for the door to convert", async () => {
    const c = icsToCandidate(read(ics("DTSTART;TZID=America/Los_Angeles:20260923T100000")), ctx)!;
    expect(c).toMatchObject({ date: "2026-09-23", start: "10:00", timeZone: "America/Los_Angeles" });
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc, c));
    expect((await svc.listEvents())[0]!.data.start).toBe("13:00");
  });

  it("the same UID with a higher SEQUENCE is the same appointment: one id, so an update never makes a second event", async () => {
    const a = icsToCandidate(read(ics("UID:u1\r\nSEQUENCE:0\r\nDTSTART:20260923T130000")), ctx)!;
    const b = icsToCandidate(read(ics("UID:u1\r\nSEQUENCE:3\r\nDTSTART:20260923T150000")), { ...ctx, messageId: "m9", threadId: "t2" })!;
    expect(a.id).toBe(b.id);
    const { svc } = setup();
    await addEmailMeetingOnce(args(svc, a));
    // The update is NOT written over the event: it reports already.
    expect((await addEmailMeetingOnce(args(svc, b))).status).toBe("already");
    expect((await svc.listEvents())[0]!.data.start).toBe("13:00");
  });

  it("a cancellation is a cancelled candidate, and the door never writes it", async () => {
    const c = icsToCandidate(read(ics("UID:u1\r\nDTSTART:20260923T130000", "METHOD:CANCEL\r\n")), ctx)!;
    expect(c.status).toBe("cancelled");
    const { svc } = setup();
    expect((await addEmailMeetingOnce(args(svc, c))).status).toBe("failed");
    expect(await svc.listEvents()).toHaveLength(0);
  });

  it("an all-day event is not a candidate", () => {
    expect(icsToCandidate(read(ics("DTSTART;VALUE=DATE:20260923")), ctx)).toBeNull();
  });

  it("a wall clock in its zone's gap has no time; an unresolvable zone asks for the zone", () => {
    const gap = icsToCandidate(readIcs(ics("DTSTART;TZID=America/New_York:20260308T023000"), { zone: "Europe/London" }).event!, ctx)!;
    expect(gap.start).toBeUndefined();
    expect(gap.missing).toEqual(["time"]);
    const odd = icsToCandidate(read(ics("DTSTART;TZID=Customized Time Zone:20260923T130000")), ctx)!;
    expect(odd.missing).toEqual(["timezone"]);
  });
});

describe("draftFromEvent and applyEventDraft: every field on the sheet round-trips", () => {
  it("an event opens on the sheet with all of its fields, and saving it unchanged writes nothing", async () => {
    const { svc } = setup();
    const id = (await svc.createEvent("Practice", { date: "2026-09-22", start: "15:00", end: "16:00", category: "c1", location: "The Field", url: "https://zoom.example/1", notes: "Bring water", travelMin: 20, bufferMin: 10 }))!;
    await svc.editGymDoor(id, true);
    const data = (await svc.event(id))!;
    const draft = draftFromEvent(data);
    expect(draft).toMatchObject({ title: "Practice", date: "2026-09-22", start: "15:00", end: "16:00", category: "c1", location: "The Field", recurrence: "none", url: "https://zoom.example/1", notes: "Bring water", travelMin: 20, bufferMin: 10, gym: true });
    const patch = vi.spyOn(store(svc), "update");
    expect(await applyEventDraft(svc, id, draft)).toBe(true);
    expect(patch).not.toHaveBeenCalled();
  });

  it("writes what the person changed on the sheet: area, place, repeat, weekdays, end date, travel, link, notes, tasks, gym", async () => {
    const { svc } = setup();
    const { id } = await addEmailMeetingOnce(args(svc)).then((r) => ({ id: r.eventId! }));
    const ok = await applyEventDraft(svc, id, {
      title: "Practice", date: "2026-09-22", start: "15:00", end: "16:00", category: "c2", location: "Field 3",
      recurrence: "weekly", days: [2, 4], interval: 2, until: "2026-12-01", travelMin: 25, bufferMin: 5,
      url: "https://zoom.example/2", notes: "Cleats", taskIds: ["task1"], gym: true,
    });
    expect(ok).toBe(true);
    expect((await svc.event(id))!).toMatchObject({
      category: "c2", location: "Field 3", recurrence: "weekly", days: [2, 4], interval: 2, until: "2026-12-01",
      travelMin: 25, bufferMin: 5, url: "https://zoom.example/2", notes: "Cleats", gym: true,
    });
  });

  it("a field whose row the sheet did not show is left alone: no project list, no project write", async () => {
    const { svc } = setup();
    const id = (await svc.createEvent("Practice", { date: "2026-09-22", start: "15:00", projectId: "p1" }))!;
    await applyEventDraft(svc, id, { title: "Practice", date: "2026-09-22", start: "15:00", end: "", category: "", location: "", recurrence: "none" });
    expect((await svc.event(id))!.projectId).toBe("p1");
    await applyEventDraft(svc, id, { title: "Practice", date: "2026-09-22", start: "15:00", end: "", category: "", location: "", recurrence: "none", projectId: "" });
    expect((await svc.event(id))!.projectId).toBeUndefined();
  });

  it("a write that throws is false, and an event that is gone is false", async () => {
    const { svc } = setup();
    const r = await addEmailMeetingOnce(args(svc));
    (svc as unknown as { editLocation: unknown }).editLocation = async () => { throw new Error("no"); };
    expect(await applyEventDraft(svc, r.eventId!, { title: "x", date: "2026-09-22", start: "15:00", end: "16:00", category: "", location: "Somewhere", recurrence: "none" })).toBe(false);
    expect(await applyEventDraft(svc, "gone", { title: "x", date: "2026-09-22", start: "15:00", end: "", category: "", location: "", recurrence: "none" })).toBe(false);
  });
});
