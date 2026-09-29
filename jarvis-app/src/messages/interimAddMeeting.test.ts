import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { ScheduleService } from "../schedule/ScheduleService";
import type { MeetingCandidate } from "./mailContracts";
import { addEmailMeetingOnce } from "./interimAddMeeting";
import { meetingFromCalendar } from "./notificationActions";
import { bundleFor, calendarInvite } from "./notificationFixtures";

const mk = () => new ScheduleService(new Store(new InMemoryAdapter()), "u1");
const candidate = (over: Partial<MeetingCandidate> = {}): MeetingCandidate => ({
  ...meetingFromCalendar(bundleFor(calendarInvite))!, ...over,
});
const ZONE = "America/New_York";

describe("addEmailMeetingOnce (interim): one save, said truthfully", () => {
  it("adds a complete event once, with a source that points back at the thread, and says so after the save", async () => {
    const svc = mk();
    const r = await addEmailMeetingOnce({ scheduleSvc: svc, candidate: candidate(), threadId: "t1", localZone: ZONE });
    expect(r.status).toBe("added");
    const events = await svc.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ title: "Practice Plan", date: "2026-10-06", start: "16:00", end: "17:00", source: { type: "gmail", ref: "t1" } });
    expect(events[0]!.id).toBe(r.eventId);
  });

  it("does not add it again from the same card, the thread, Today or an import", async () => {
    const svc = mk();
    const args = { scheduleSvc: svc, candidate: candidate(), threadId: "t1", localZone: ZONE };
    expect((await addEmailMeetingOnce(args)).status).toBe("added");
    // Today again, or the thread's own calendar card: the same call.
    const again = await addEmailMeetingOnce(args);
    expect(again.status).toBe("already");
    expect(again.undo).toBeUndefined();
    expect(await svc.listEvents()).toHaveLength(1);

    // An event the ICS card wrote, under the same name, from no thread we know.
    const other = mk();
    await other.createEvent("practice  plan", { date: "2026-10-06", start: "16:00" });
    expect((await addEmailMeetingOnce({ scheduleSvc: other, candidate: candidate(), threadId: "t9", localZone: ZONE })).status).toBe("already");

    // A Google Calendar import of the same invitation.
    const imported = mk();
    await imported.createEvent("Practice Plan", { date: "2026-10-06", start: "16:00", gcalId: "g1" });
    expect((await addEmailMeetingOnce({ scheduleSvc: imported, candidate: candidate(), threadId: "t1", localZone: ZONE })).status).toBe("already");

    // A different name from the same thread at the same minute is still that appointment.
    const renamed = mk();
    await renamed.createEvent("Practice (Coach Ana)", { date: "2026-10-06", start: "16:00", source: { type: "gmail", ref: "t1", ts: 1 } });
    expect((await addEmailMeetingOnce({ scheduleSvc: renamed, candidate: candidate(), threadId: "t1", localZone: ZONE })).status).toBe("already");
  });

  it("a different appointment at another time or on another day is added", async () => {
    const svc = mk();
    await svc.createEvent("Practice Plan", { date: "2026-10-06", start: "09:00" });
    await svc.createEvent("Practice Plan", { date: "2026-10-07", start: "16:00" });
    expect((await addEmailMeetingOnce({ scheduleSvc: svc, candidate: candidate(), threadId: "t1", localZone: ZONE })).status).toBe("added");
    expect(await svc.listEvents()).toHaveLength(3);
  });

  it("Undo removes only the entry it made, and says true only when it is gone", async () => {
    const svc = mk();
    const keep = (await svc.createEvent("Lunch", { date: "2026-10-06", start: "12:00" }))!;
    const r = await addEmailMeetingOnce({ scheduleSvc: svc, candidate: candidate(), threadId: "t1", localZone: ZONE });
    expect(await r.undo!()).toBe(true);
    const left = await svc.listEvents();
    expect(left.map((e) => e.id)).toEqual([keep]);
    const stuck = { ...svc, deleteEvent: async () => {}, event: async () => ({ title: "x" }) } as unknown as ScheduleService;
    stuck.listEvents = svc.listEvents.bind(svc);
    stuck.createEvent = svc.createEvent.bind(svc);
    const r2 = await addEmailMeetingOnce({ scheduleSvc: stuck, candidate: candidate(), threadId: "t1", localZone: ZONE });
    expect(await r2.undo!()).toBe(false);
  });

  it("an incomplete candidate, or one in another time zone, writes nothing and asks for review", async () => {
    const svc = mk();
    expect((await addEmailMeetingOnce({ scheduleSvc: svc, candidate: candidate({ missing: ["time"], start: undefined }), threadId: "t1", localZone: ZONE })).status).toBe("incomplete");
    expect((await addEmailMeetingOnce({ scheduleSvc: svc, candidate: candidate({ status: "cancelled" }), threadId: "t1", localZone: ZONE })).status).toBe("incomplete");
    expect((await addEmailMeetingOnce({ scheduleSvc: svc, candidate: candidate({ timeZone: "Europe/London" }), threadId: "t1", localZone: ZONE })).status).toBe("incomplete");
    expect((await addEmailMeetingOnce({ scheduleSvc: svc, candidate: candidate({ timeZone: ZONE }), threadId: "t1", localZone: ZONE })).status).toBe("added");
    expect(await svc.listEvents()).toHaveLength(1);
  });

  it("a schedule that cannot be read or written is a failure, never an 'added'", async () => {
    const svc = mk();
    const broken = { listEvents: async () => { throw new Error("x"); }, createEvent: svc.createEvent.bind(svc), deleteEvent: svc.deleteEvent.bind(svc), event: svc.event.bind(svc) };
    expect((await addEmailMeetingOnce({ scheduleSvc: broken as never, candidate: candidate(), threadId: "t1", localZone: ZONE })).status).toBe("failed");
    const noWrite = { ...broken, listEvents: svc.listEvents.bind(svc), createEvent: async () => null };
    const r = await addEmailMeetingOnce({ scheduleSvc: noWrite as never, candidate: candidate(), threadId: "t1", localZone: ZONE });
    expect(r.status).toBe("failed");
    expect(r.undo).toBeUndefined();
  });
});
