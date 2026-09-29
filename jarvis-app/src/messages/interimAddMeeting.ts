import type { ScheduleService } from "../schedule/ScheduleService";
import type { AddMeetingResult, MeetingCandidate } from "./mailContracts";
import { isCompleteMeeting } from "./notificationActions";

// THE INTERIM addEmailMeetingOnce (2026-09-29).
//
// The appointment workstream (brief v4, the finish card) owns the real one, in
// messages/emailSchedule.ts, with the same signature. Until that merges, Today's
// Accept and Add to Schedule need SOMETHING that saves once and says what
// happened, and it has to be safe to swap: the integration at merge is one
// import line in TodayFlow.tsx and this file is deleted.
//
// What it promises, the same as the contract in mailContracts.ts:
//   - "added" only after the save landed, and an Undo that removes only the
//     entry this call made and says true only when it is gone.
//   - "already" when the schedule holds this appointment, whoever put it there
//     (this card, the thread's calendar card, the Google Calendar import, a
//     booking): the same date and start, under the same name or from the same
//     thread. Nothing is written.
//   - "incomplete" when the candidate is not complete, or is written in another
//     time zone (converting needs a zone database this app does not ship): the
//     caller opens the review flow instead of writing a wrong time.
// It never writes to Google. Google Calendar is read-only to this app.

type Schedule = Pick<ScheduleService, "listEvents" | "createEvent" | "deleteEvent" | "event">;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export async function addEmailMeetingOnce(args: {
  scheduleSvc: Schedule;
  candidate: MeetingCandidate;
  threadId: string;
  account?: string;
  title?: string;
  /** For tests: the zone this device is in. */
  localZone?: string;
}): Promise<AddMeetingResult> {
  const { scheduleSvc, candidate, threadId } = args;
  if (!isCompleteMeeting(candidate)) return { status: "incomplete", message: "Needs a Date and Time" };
  const zone = args.localZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (candidate.timeZone && candidate.timeZone !== zone) return { status: "incomplete", message: "Time Zone to Check" };
  const name = (args.title ?? candidate.title).trim();
  if (!name) return { status: "incomplete", message: "Needs a Title" };

  let events: Awaited<ReturnType<Schedule["listEvents"]>>;
  try { events = await scheduleSvc.listEvents(); } catch { return { status: "failed", message: "Couldn't Check Your Schedule · Nothing Added" }; }
  const dup = events.find((e) => {
    const d = e.data;
    if (d.date !== candidate.date || d.start !== candidate.start) return false;
    return norm(d.title) === norm(name) || (d.source?.type === "gmail" && d.source.ref === threadId);
  });
  if (dup) return { status: "already", eventId: dup.id, message: "Already on your schedule" };

  let id: string | null = null;
  try {
    id = await scheduleSvc.createEvent(name, {
      date: candidate.date!,
      start: candidate.start!,
      ...(candidate.end ? { end: candidate.end } : {}),
      source: { type: "gmail", ref: threadId, ts: Date.now() },
    });
  } catch { id = null; }
  if (!id) return { status: "failed", message: "Couldn't Add It · Nothing Was Saved" };
  const made = id;
  return {
    status: "added",
    eventId: made,
    message: "Added to your schedule",
    undo: async () => {
      try { await scheduleSvc.deleteEvent(made); return (await scheduleSvc.event(made)) === null; } catch { return false; }
    },
  };
}
