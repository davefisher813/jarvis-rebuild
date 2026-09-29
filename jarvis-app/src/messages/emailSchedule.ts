import type { ScheduleService } from "../schedule/ScheduleService";
import type { EventData } from "../schedule/types";
import type { EventDraft } from "../schedule/screens/EventSheet";
import { madeBy } from "../shared/provenance";
import { cyrb53, stableId } from "./briefSource";
import type { IcsEvent } from "./ics";
import type { AddMeetingResult, MeetingCandidate, MeetingMissing } from "./mailContracts";
import { inReadersZone, whenLine } from "./meetingWhen";
import { deviceZone } from "./zoneTime";
import { todayISO } from "../schedule/calendar";

// PUTTING WHAT AN EMAIL SET ON THE CALENDAR, ONCE (2026-09-29).
//
// This is the one door every "add this appointment" tap goes through: the
// finish card above a thread, the .ics attachment offer, and the Today
// notification actions (add_travel, accept_invite). It replaces the handler
// that lived in MessagesFlow, which had three holes:
//
//   - IT COULD WRITE TWICE. The only guard was a lookup by thread id on the
//     meeting's own day, so a second tap during the first write, a reload
//     before the lookup finished, a second device, or a reschedule that moved
//     the day all made a second event.
//   - ITS UNDO CLAIMED MORE THAN IT KNEW. It swallowed a failed delete and
//     reset the card as if the event were gone.
//   - IT HAD NO ANSWER FOR AN INCOMPLETE APPOINTMENT. It wrote whatever it was
//     handed.
//
// What holds now, and what it rests on:
//
//   1. IN-FLIGHT GUARD, in this module: a second call for the same appointment
//      while the first is still running gets the SAME promise. That covers a
//      double tap and two callers in one app. It says nothing about another
//      device, which is why the next one exists.
//   2. DURABLE IDEMPOTENCY, in the data layer: every event made here carries a
//      clientId derived from the account and the detected appointment. The
//      core store treats a second create with the same clientId as the first
//      (jarvis-core inMemoryAdapter and supabaseAdapter, and the partial unique
//      index on (owner_id, data->>'clientId') in migration 0039), so a reload,
//      a lost reply, a second tap on another phone or a replayed offline queue
//      lands as ONE row. Nothing in React state is relied on for this.
//   3. A LOOK FIRST, so the answer can be "already" instead of a silent no-op,
//      and so a legacy event made by the old handler (stamped with the thread,
//      no clientId) is recognised.
//   4. UNDO IS CONFIRMED. It deletes only a row that still carries this
//      appointment's clientId, reads it back, and reports true only when the
//      row is gone. A failed or unconfirmed delete reports false.
//
// WHAT IS NOT PROVEN, said plainly: the unique index has been exercised in this
// repo against a real Postgres (see the migration test), not against the live
// project, and a create made OFFLINE on two phones is only deduplicated when
// the second one replays, by the same index; until then each phone shows its
// own pending row. The "already" answer is a read, and another device's row
// that has not synced yet is invisible to it. Nothing here writes on its own:
// detecting an appointment never calls this, a tap does.

/** The parts of the Schedule service this door uses, so a test can fail any of them. */
export type EmailScheduleSvc = Pick<ScheduleService, "createEvent" | "listEvents" | "event" | "deleteEvent">;
export type EmailReviseSvc = EmailScheduleSvc & Pick<ScheduleService, "editTitle" | "moveDay" | "editTime" | "editEnd" | "linkEmailIds">;

export interface AddEmailMeetingArgs {
  scheduleSvc: EmailScheduleSvc;
  candidate: MeetingCandidate;
  threadId: string;
  account: string;
  /** Overrides the candidate's title, for a caller that has a better one (the subject). */
  title?: string;
  /** The reader's zone. Defaults to the device's. Tests pin it. */
  zone?: string;
}

/**
 * The idempotency key for one detected appointment in one mailbox. It is
 * derived from the account and the candidate's own stable id, so the same
 * appointment read on any device, in any session, is the same key, and two
 * different appointments in one thread are two.
 */
export function meetingClientId(account: string, candidateId: string): string {
  const key = account.trim().toLowerCase() + "␟" + candidateId;
  return "emailmtg_" + cyrb53(key).toString(36) + cyrb53(key, 11).toString(36);
}

const inFlight = new Map<string, Promise<AddMeetingResult>>();

const MISSING_WORDS: Record<MeetingMissing, string> = {
  date: "a Day", time: "a Time", meridiem: "AM or PM", timezone: "a Time Zone",
};

/** "Needs a Day and a Time": what the sentence did not settle, as a fragment. */
export function missingLine(missing: readonly MeetingMissing[]): string {
  const words = [...new Set(missing)].map((m) => MISSING_WORDS[m]);
  if (words.length === 0) return "";
  return "Needs " + (words.length === 1 ? words[0] : words.slice(0, -1).join(", ") + " and " + words[words.length - 1]);
}

/**
 * Is this appointment already on the calendar? Read only: it never writes.
 * Found by the clientId, by a reschedule that was applied to another event and
 * linked to this one, or, for an event the old handler made, by the thread and
 * the same day and start. Returns the event id, or null.
 */
export async function findFiledMeeting(
  scheduleSvc: Pick<ScheduleService, "listEvents">,
  args: { account: string; threadId: string; candidate: MeetingCandidate; zone?: string },
): Promise<string | null> {
  const cid = meetingClientId(args.account, args.candidate.id);
  const events = await scheduleSvc.listEvents();
  const slot = inReadersZone(args.candidate, args.zone ?? deviceZone());
  const hit = events.find((e) => {
    if (e.data.clientId === cid || e.data.emailIds?.includes(cid)) return true;
    // The old handler stamped the thread and nothing else. Same thread, same
    // day, same start is the same appointment.
    const src = e.data.source;
    return !!slot && src?.type === "email" && src.ref === args.threadId && !e.data.clientId && e.data.date === slot.date && e.data.start === slot.start;
  });
  return hit?.id ?? null;
}

async function run(args: AddEmailMeetingArgs, cid: string): Promise<AddMeetingResult> {
  const { scheduleSvc: svc, candidate: c } = args;
  const zone = args.zone ?? deviceZone();
  if (c.status === "cancelled") return { status: "failed", message: "Cancelled · Nothing to Add" };
  // The sentence did not settle it: the caller asks, it does not write.
  if (c.missing.length > 0 || !c.date || !c.start) {
    return { status: "incomplete", message: missingLine(c.missing.length ? c.missing : [!c.date ? "date" : "time"]) };
  }
  const slot = inReadersZone(c, zone);
  // A wall clock that does not exist in its own zone that day (the
  // spring-forward gap) or happens twice is not one moment.
  if (!slot) return { status: "incomplete", message: "Needs a Time" };

  let existing: string | null = null;
  let looked = true;
  try {
    existing = await findFiledMeeting(svc, { account: args.account, threadId: args.threadId, candidate: c, zone });
  } catch {
    // Could not look. The create below is still idempotent (item 2 above), but
    // this run cannot say whether it added the row or found it, so it will not
    // offer an Undo for a row it may not have made.
    looked = false;
  }
  if (existing) return { status: "already", eventId: existing, message: "Already on Your Calendar" };

  const title = (args.title ?? c.title).trim() || "Appointment";
  let id: string | null = null;
  try {
    id = await svc.createEvent(title, {
      date: slot.date, start: slot.start, end: slot.end,
      source: madeBy("email", args.threadId),
      clientId: cid,
    });
  } catch {
    return { status: "failed", message: "Couldn't Add It · Nothing Was Saved" };
  }
  if (!id) return { status: "failed", message: "Couldn't Add It · Nothing Was Saved" };
  const eventId: string = id;

  // "Added" is only said when the row can be read back.
  let landed: Awaited<ReturnType<EmailScheduleSvc["event"]>> = null;
  try { landed = await svc.event(eventId); } catch { landed = null; }
  if (!landed) return { status: "failed", message: "Couldn't Confirm It · Check Your Calendar" };

  const message = "On Your Calendar · " + whenLine({ date: slot.date, start: slot.start, end: slot.end }, todayISO());
  if (!looked) return { status: "added", eventId, message };

  let undoing: Promise<boolean> | null = null;
  const undo = (): Promise<boolean> => {
    if (undoing) return undoing;
    undoing = (async () => {
      try {
        const now = await svc.event(eventId);
        // Already gone: the state the person asked for.
        if (!now) return true;
        // Only the row this made. An event that no longer carries the
        // appointment's key is not ours to delete.
        if (now.clientId !== cid) return false;
        await svc.deleteEvent(eventId);
        return (await svc.event(eventId)) === null;
      } catch {
        return false;
      }
    })().finally(() => { undoing = null; });
    return undoing;
  };
  return { status: "added", eventId, message, undo };
}

/**
 * Add one detected appointment to Jarvis's own calendar, at most once.
 * `already` when it was added before (this device or another), `incomplete`
 * when it lacks a day, a time or AM/PM (the caller opens the editor prefilled),
 * `failed` when the write did not land. Only ever called from a tap.
 */
export function addEmailMeetingOnce(args: AddEmailMeetingArgs): Promise<AddMeetingResult> {
  const cid = meetingClientId(args.account, args.candidate.id);
  const running = inFlight.get(cid);
  if (running) return running;
  const p = run(args, cid).finally(() => { if (inFlight.get(cid) === p) inFlight.delete(cid); });
  inFlight.set(cid, p);
  return p;
}

/** For tests: forget every in-flight add. */
export function resetEmailScheduleState(): void { inFlight.clear(); }

export interface ReviseDraft { title: string; date: string; start: string; end: string }

/**
 * Apply a reviewed change to an event that is already on the calendar: the
 * sender rescheduled, and the person looked at the new time and said yes. Also
 * links the new detection to this event so the next open does not offer to add
 * it again. Reports true only when the event reads back with the new time.
 */
export async function reviseFiledMeeting(
  svc: EmailReviseSvc, eventId: string, draft: ReviseDraft, links?: { account: string; candidateId: string },
): Promise<boolean> {
  try {
    const cur = await svc.event(eventId);
    if (!cur) return false;
    if (draft.title.trim() && draft.title.trim() !== cur.title) await svc.editTitle(eventId, draft.title);
    if (draft.date !== cur.date) await svc.moveDay(eventId, draft.date);
    if (draft.start !== cur.start) await svc.editTime(eventId, draft.start);
    if ((draft.end || undefined) !== cur.end) await svc.editEnd(eventId, draft.end);
    if (links) await svc.linkEmailIds(eventId, [meetingClientId(links.account, links.candidateId)]);
    const after = await svc.event(eventId);
    return !!after && after.date === draft.date && after.start === draft.start;
  } catch {
    return false;
  }
}

/**
 * An .ics attachment's first event as a detected appointment, in the shape the
 * one door takes. Identity is the calendar's own UID when it has one (so an
 * updated invitation is the same appointment, not a second one), and the
 * title, day and start when it does not. An all-day event has no time to put
 * on a calendar: null, and the caller keeps its all-day fallback. A cancelled
 * one is returned as cancelled and is never written.
 */
export function icsToCandidate(ev: IcsEvent, ctx: { account: string; threadId: string; messageId: string }): MeetingCandidate | null {
  if (!ev.start) return null;
  const date = ev.sourceDate ?? ev.date;
  const start = ev.timeUncertain ? undefined : (ev.sourceStart ?? ev.start);
  const missing: MeetingMissing[] = [];
  if (!start) missing.push("time");
  if (ev.zoneUnresolved) missing.push("timezone");
  const stated = ev.durationMin !== undefined;
  const mins = Math.min(ev.durationMin ?? 60, 24 * 60);
  let end: string | undefined;
  if (start) {
    const from = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
    const to = Math.min(24 * 60 - 1, from + mins);
    end = `${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}`;
  }
  const key = ev.uid ? "uid:" + ev.uid : "ics:" + ev.title + "|" + date + "|" + (ev.sourceStart ?? ev.start);
  return {
    id: stableId("mc", ctx.account, "ics", "ics", key),
    sourceMessageId: ctx.messageId,
    sourceQuote: ev.title,
    title: ev.title,
    status: ev.status === "cancelled" ? "cancelled" : "agreed",
    date,
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(ev.sourceZone ? { timeZone: ev.sourceZone } : {}),
    missing: ev.status === "cancelled" ? [] : missing,
    durationSource: stated ? "stated" : "default",
  };
}

/**
 * An existing event as the event sheet's draft, every field it shows, so a
 * sheet opened on it round-trips: nothing the person did not touch is lost on
 * Save. (laws/sheetFields.test.ts is the rule this serves.)
 */
export function draftFromEvent(e: EventData): EventDraft {
  return {
    title: e.title, date: e.date, start: e.start, end: e.end ?? "",
    category: e.category, location: e.location ?? "", recurrence: e.recurrence ?? "none",
    ...(e.until ? { until: e.until } : {}),
    ...(e.taskIds ? { taskIds: e.taskIds } : {}),
    ...(e.days ? { days: e.days } : {}),
    ...(e.interval ? { interval: e.interval } : {}),
    ...(e.attendees ? { attendees: e.attendees } : {}),
    ...(e.travelMin !== undefined ? { travelMin: e.travelMin } : {}),
    ...(e.bufferMin !== undefined ? { bufferMin: e.bufferMin } : {}),
    ...(e.url ? { url: e.url } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
    ...(e.projectId ? { projectId: e.projectId } : {}),
    ...(e.gym ? { gym: true } : {}),
  };
}

type DraftSvc = Pick<ScheduleService, "event" | "editCategory" | "editLocation" | "editRecurrence" | "editWeekdays" | "editUntil" | "editTravel" | "editMeeting" | "editTaskIds" | "editGymDoor" | "editProject">;

/**
 * Everything on the event sheet EXCEPT the four the door owns (title, day,
 * start, end): area, place, repeat, weekdays, end date, travel, link, notes,
 * attached tasks, the gym door and the project, written to the event the way
 * the schedule's own Save writes them. Only what changed is written, and
 * fields whose row the sheet did not show (a project list it was not given) are
 * left alone: writing their empty default would erase a real value. Reports
 * false if any write failed.
 */
export async function applyEventDraft(svc: DraftSvc, eventId: string, d: EventDraft): Promise<boolean> {
  try {
    const cur = await svc.event(eventId);
    if (!cur) return false;
    if (d.category !== undefined && d.category !== cur.category) await svc.editCategory(eventId, d.category);
    if ((d.location ?? "") !== (cur.location ?? "")) await svc.editLocation(eventId, d.location ?? "");
    if ((d.recurrence ?? "none") !== (cur.recurrence ?? "none")) await svc.editRecurrence(eventId, d.recurrence ?? "none");
    if (d.recurrence === "weekly") await svc.editWeekdays(eventId, d.days ?? [], d.interval ?? 1);
    if ((d.until ?? "") !== (cur.until ?? "")) await svc.editUntil(eventId, d.until || null);
    if ((d.travelMin ?? null) !== (cur.travelMin ?? null) || (d.bufferMin ?? null) !== (cur.bufferMin ?? null)) await svc.editTravel(eventId, d.travelMin ?? null, d.bufferMin ?? null);
    if ((d.url ?? "") !== (cur.url ?? "") || (d.notes ?? "") !== (cur.notes ?? "")) await svc.editMeeting(eventId, { url: d.url ?? "", notes: d.notes ?? "" });
    if (d.taskIds !== undefined && JSON.stringify(d.taskIds) !== JSON.stringify(cur.taskIds ?? [])) await svc.editTaskIds(eventId, d.taskIds);
    if (!!d.gym !== !!cur.gym) await svc.editGymDoor(eventId, !!d.gym);
    if (d.projectId !== undefined && (d.projectId || "") !== (cur.projectId ?? "")) await svc.editProject(eventId, d.projectId || null);
    return true;
  } catch {
    return false;
  }
}
