import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { EventDraft } from "../schedule/screens/EventSheet";
import { todayISO } from "../schedule/calendar";
import { haptics } from "../shared/haptics";
import { rowDoor } from "../shared/rowDoor";
import { titleCase } from "../shared/casing";
import { Facts, type Fact } from "./factsLine";
import MeetingEventSheet from "./MeetingEventSheet";
import { addEmailMeetingOnce, applyEventDraft, draftFromEvent, findFiledMeeting, reviseFiledMeeting } from "./emailSchedule";
import { attemptWrite } from "../shared/guard";
import type { MeetingCandidate } from "./mailContracts";
import { meetingOffers, type MeetingOffer } from "./meetingOffers";
import { inReadersZone, meetingFacts, whenLine } from "./meetingWhen";
import { deviceZone } from "./zoneTime";

// THE APPOINTMENT, FINISHED FROM THE THREAD (2026-09-29).
//
// Dave 2026-09-16: "this should be EXTREMELY easy to add to the Jarvis
// calendar ... That's the entire point of it being able to read my emails."
// The offer used to live inside "Where This Stands", a card that is collapsed
// by default and folds its detail behind "What was said", so the one thing the
// whole feature exists for was the thing you had to open something to reach.
// It sits ABOVE the messages now, outside that card, and the state card has no
// calendar action of its own any more: one offer, one place.
//
// What it shows is decided by meetingOffers.ts from what the thread said:
//
//   - A whole answer ("See you Tuesday at 3 PM") shows the day, the time, the
//     zone and the length, and adds on one tap.
//   - A partial one asks for exactly what is missing and never guesses it:
//     "Tuesday at 3" offers 3 AM and 3 PM, "Thursday morning" offers Set Time.
//     Anything it cannot finish opens the schedule's own event sheet, filled in
//     with what the message did say.
//   - The default length is always labelled "1h · Default", never as the
//     sender's.
//   - A reschedule of something already on the calendar offers Review Change,
//     which opens the sheet on the new time and applies it to that event only
//     when saved. A cancellation removes the offer and DELETES NOTHING; an event
//     already on the calendar is reported, with a door to review it.
//
// The card runs one effect and it only LOOKS (is this already filed?). Every
// write is a handler a person pressed, through emailSchedule.addEmailMeetingOnce.
// It renders only when there is a Schedule service to write to.

export interface MeetingNotice { message: string; undo?: { label: string; run: () => void } }

type SheetState =
  | { kind: "fill"; offer: MeetingOffer }
  | { kind: "review"; offer: MeetingOffer; event: EventDraft }
  | { kind: "cancelled"; offer: MeetingOffer; event: EventDraft };

const hhmm = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const hourWord = (h: number, m: number) => (m === 0 ? String(h) : h + ":" + String(m).padStart(2, "0"));

export default function MeetingFinishCard({
  scheduleSvc, threadId, account, candidates, order, onNotice, today = todayISO(), zone = deviceZone(),
}: {
  scheduleSvc: ScheduleService;
  threadId: string;
  account: string;
  /** The brief's meetingCandidates. Undefined (not analysed) and [] (none) both draw nothing. */
  candidates: readonly MeetingCandidate[] | undefined;
  /** Chronological message ids, oldest first. */
  order?: readonly string[];
  /** A receipt, for a caller that shows one (the mail toast). The card also says it inline. */
  onNotice?: (n: MeetingNotice) => void;
  today?: string;
  zone?: string;
}) {
  const [filed, setFiled] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Record<string, { eventId: string; undo?: () => Promise<boolean> }>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // LOOK, never write: which of these are already on the calendar? Read once
  // per candidate list, so opening a thread costs a few local reads.
  useEffect(() => {
    let on = true;
    const live = (candidates ?? []).filter((c) => c.status === "agreed" || c.status === "cancelled");
    if (live.length === 0) return;
    void (async () => {
      const found: Record<string, string> = {};
      for (const c of live) {
        try {
          const id = await findFiledMeeting(scheduleSvc, { account, threadId, candidate: c, zone });
          if (id) found[c.id] = id;
        } catch { /* a failed look is "not known", and Add is still idempotent */ }
      }
      if (on) setFiled((prev) => ({ ...prev, ...found }));
    })();
    return () => { on = false; };
  }, [candidates, scheduleSvc, account, threadId, zone]);

  const offers = useMemo(() => {
    const known: Record<string, string> = { ...filed };
    for (const [id, a] of Object.entries(added)) known[id] = a.eventId;
    return meetingOffers({ candidates: candidates ?? [], ...(order ? { order } : {}), filed: known, today });
  }, [candidates, order, filed, added, today]);

  const say = useCallback((n: MeetingNotice) => { onNotice?.(n); }, [onNotice]);

  const undoAdd = useCallback(async (id: string) => {
    const a = added[id];
    if (!a?.undo) return;
    const ok = await a.undo();
    if (!ok) { setFailed("Couldn't Remove It · Check Your Calendar"); say({ message: "Couldn't Remove It · Check Your Calendar" }); return; }
    setAdded((p) => { const n = { ...p }; delete n[id]; return n; });
    setFiled((p) => { const n = { ...p }; delete n[id]; return n; });
    setFailed(null);
    say({ message: "Removed From Your Calendar" });
  }, [added, say]);

  // THE TAP. Always through the one door, which is idempotent and reports what
  // actually happened.
  const add = useCallback(async (c: MeetingCandidate, patch: Partial<MeetingCandidate> = {}, after?: (eventId: string) => Promise<void>) => {
    if (busy[c.id]) return;
    setBusy((p) => ({ ...p, [c.id]: true }));
    setFailed(null);
    try {
      const candidate = { ...c, ...patch };
      const r = await addEmailMeetingOnce({ scheduleSvc, candidate, threadId, account, zone });
      if (r.status === "added" && r.eventId) {
        if (after) await after(r.eventId).catch(() => {});
        setAdded((p) => ({ ...p, [c.id]: { eventId: r.eventId!, ...(r.undo ? { undo: r.undo } : {}) } }));
        say({
          message: r.message,
          ...(r.undo ? { undo: { label: "Undo", run: () => void undoAdd(c.id) } } : {}),
        });
      } else if (r.status === "already" && r.eventId) {
        setFiled((p) => ({ ...p, [c.id]: r.eventId! }));
        say({ message: r.message });
      } else if (r.status === "incomplete") {
        setSheet({ kind: "fill", offer: { kind: "ask", candidate: c } });
      } else {
        setFailed(r.message);
        say({ message: r.message });
      }
    } finally {
      setBusy((p) => { const n = { ...p }; delete n[c.id]; return n; });
    }
  }, [busy, scheduleSvc, threadId, account, zone, say, undoAdd]);

  // What the sheet opens with: the appointment as the calendar will hold it
  // (the sender's zone converted), or just the day when there is no time yet.
  const seedFor = (c: MeetingCandidate): Partial<EventDraft> => {
    const slot = inReadersZone(c, zone);
    return {
      title: titleCase(c.title),
      date: slot?.date ?? c.date ?? today,
      // A time with no day cannot be converted between zones, so it goes in as the sender wrote it.
      start: slot?.start ?? c.start ?? "",
      end: slot?.end ?? c.end ?? "",
      category: "", location: "", recurrence: "none",
    };
  };

  // Opens the sheet on an event that is already on the calendar, every field
  // loaded from it. Review Change lays the sender's new day and time over it;
  // a cancellation shows it as it stands, with Delete Event for the person to
  // press if they want it gone.
  const openOnEvent = async (offer: MeetingOffer, kind: "review" | "cancelled") => {
    if (!offer.eventId) return;
    const ev = await scheduleSvc.event(offer.eventId).catch(() => null);
    if (!ev) { setFiled((p) => { const n = { ...p }; for (const k of Object.keys(n)) if (n[k] === offer.eventId) delete n[k]; return n; }); return; }
    const base = draftFromEvent(ev);
    if (kind === "cancelled") { setSheet({ kind, offer, event: base }); return; }
    const seed = seedFor(offer.candidate);
    // Only what the sender's sentence settled replaces what the event has: a
    // day part with no time, or no day, leaves the event's own.
    setSheet({
      kind, offer,
      event: {
        ...base,
        title: seed.title ?? base.title,
        date: offer.candidate.date ? (seed.date ?? base.date) : base.date,
        start: offer.candidate.start ? (seed.start ?? base.start) : base.start,
        end: offer.candidate.start ? (seed.end ?? base.end) : base.end,
      },
    });
  };

  const saveFill = async (offer: MeetingOffer, d: EventDraft) => {
    const c = offer.candidate;
    setSheet(null);
    // What the person typed IS the answer, in their own clock: the sender's zone no longer applies.
    const own: MeetingCandidate = { ...c, title: d.title, date: d.date, start: d.start, end: d.end || d.start, missing: [], durationSource: "default" };
    delete own.timeZone;
    await add(own, {}, async (eventId) => {
      // Everything else on the sheet, the way the schedule's own Save writes it.
      await attemptWrite(async () => { if (!(await applyEventDraft(scheduleSvc, eventId, d))) throw new Error("draft"); });
    });
  };

  const saveReview = async (offer: MeetingOffer, d: EventDraft) => {
    setSheet(null);
    if (!offer.eventId) return;
    const eventId = offer.eventId;
    const ok = await reviseFiledMeeting(scheduleSvc, eventId, { title: d.title, date: d.date, start: d.start, end: d.end }, { account, candidateId: offer.candidate.id })
      && await applyEventDraft(scheduleSvc, eventId, d);
    if (!ok) { setFailed("Couldn't Update It \u00b7 Check Your Calendar"); say({ message: "Couldn't Update It \u00b7 Check Your Calendar" }); return; }
    setFiled((p) => ({ ...p, [offer.candidate.id]: eventId }));
    say({ message: "Updated \u00b7 " + whenLine({ date: d.date, start: d.start, end: d.end }, today) });
  };

  // Save on the cancelled event's own sheet edits it like any event: the
  // person is looking at their own calendar entry.
  const saveCancelled = async (offer: MeetingOffer, d: EventDraft) => {
    setSheet(null);
    if (!offer.eventId) return;
    const ok = await reviseFiledMeeting(scheduleSvc, offer.eventId, { title: d.title, date: d.date, start: d.start, end: d.end })
      && await applyEventDraft(scheduleSvc, offer.eventId, d);
    if (!ok) { setFailed("Couldn't Update It \u00b7 Check Your Calendar"); say({ message: "Couldn't Update It \u00b7 Check Your Calendar" }); }
  };

  const removeFiled = async (offer: MeetingOffer) => {
    setSheet(null);
    const id = offer.eventId;
    if (!id) return;
    const snapshot = await scheduleSvc.event(id).catch(() => null);
    try { await scheduleSvc.deleteEvent(id); } catch { /* confirmed below */ }
    const gone = (await scheduleSvc.event(id).catch(() => snapshot)) === null;
    if (!gone) { setFailed("Couldn't Remove It · Check Your Calendar"); say({ message: "Couldn't Remove It · Check Your Calendar" }); return; }
    setFiled((p) => { const n = { ...p }; for (const k of Object.keys(n)) if (n[k] === id) delete n[k]; return n; });
    setAdded((p) => { const n = { ...p }; for (const k of Object.keys(n)) if (n[k]!.eventId === id) delete n[k]; return n; });
    say({
      message: "Removed From Your Calendar",
      ...(snapshot ? { undo: { label: "Undo", run: () => void attemptWrite(() => scheduleSvc.recreateFrom(snapshot, id)) } } : {}),
    });
  };

  if (offers.length === 0 && !sheet) return null;

  const factsFor = (o: MeetingOffer): (Fact | false)[] => {
    const c = o.candidate;
    const f = meetingFacts(c, today, zone);
    const asking = o.kind === "ask" ? o.ask : undefined;
    return [
      o.kind === "review_change" && { text: "Rescheduled", tone: "warn" },
      o.kind === "cancelled_filed" && { text: "Cancelled", tone: "red" },
      o.kind === "filed" && { text: "On Your Calendar", tone: "good" },
      f.day ? { text: f.day, tone: "date" } : asking === "date" && { text: "Day?", tone: "warn" },
      f.time
        ? { text: f.time }
        : o.kind === "ask" && o.hour ? { text: hourWord(o.hour.hour, o.hour.minute) + " · AM or PM?", tone: "warn" }
        : c.dayPart ? { text: titleCase(c.dayPart) + " · Time?", tone: "warn" }
        : o.kind === "ask" && { text: "Time?", tone: "warn" },
      // The length comes BEFORE the zone: on one line the last fact gives way,
      // and "1h · Default" is the honesty (the length is the app's, not the
      // sender's), so it must not be the fact that gets cut. Found by rendering
      // the card at 390px.
      o.kind !== "cancelled_filed" && !!f.length && { text: f.length },
      o.kind !== "cancelled_filed" && !!c.start && { text: f.zoneLabel },
      o.kind !== "cancelled_filed" && !!f.yours && { text: f.yours },
      o.kind === "cancelled_filed" && { text: "Still on Your Calendar" },
      asking === "timezone" && { text: "Time Zone?", tone: "warn" },
    ];
  };

  return (
    <>
      <div className="card msg-summary">
        <div className="eyebrow">{offers.length > 1 ? "Appointments" : "Appointment"}</div>
        {offers.map((o) => {
          const c = o.candidate;
          const isBusy = !!busy[c.id];
          const open = () => { haptics.selection(); if (o.kind === "review_change") void openOnEvent(o, "review"); else setSheet({ kind: "fill", offer: o }); };
          const tap = (fn: () => void) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); haptics.selection(); fn(); };
          // The row is the door: for a whole answer it adds (the same tap as
          // the pill); for one that needs asking it opens the sheet.
          const door =
            o.kind === "add" ? () => void add(c)
            : o.kind === "ask" ? open
            : o.kind === "review_change" ? open
            : o.kind === "cancelled_filed" ? () => void openOnEvent(o, "cancelled")
            : added[c.id]?.undo ? () => void undoAdd(c.id)
            : null;
          return (
            <div className="row msg-stands-act" key={c.id} {...(door ? rowDoor(() => { haptics.selection(); door(); }) : {})}>
              <div className="row-grow">
                <div className="conn-name">{titleCase(c.title)}</div>
                <Facts facts={factsFor(o)} />
              </div>
              {o.kind === "add" && (
                <button className="pill-act" disabled={isBusy} onClick={tap(() => void add(c))}>{isBusy ? "Adding…" : "Add to Calendar"}</button>
              )}
              {o.kind === "ask" && o.ask === "meridiem" && o.hour && (
                <>
                  <button className="pill-act" disabled={isBusy} onClick={tap(() => void add(c, meridiemPatch(c, o.hour!.hour, o.hour!.minute, "am")))}>{"Add as " + hourWord(o.hour.hour, o.hour.minute) + " AM"}</button>
                  <button className="pill-act" disabled={isBusy} onClick={tap(() => void add(c, meridiemPatch(c, o.hour!.hour, o.hour!.minute, "pm")))}>{"Add as " + hourWord(o.hour.hour, o.hour.minute) + " PM"}</button>
                </>
              )}
              {o.kind === "ask" && !(o.ask === "meridiem" && o.hour) && (
                <button className="pill-act" onClick={tap(open)}>{o.ask === "date" ? "Set Day" : o.ask === "timezone" ? "Check Time" : "Set Time"}</button>
              )}
              {o.kind === "review_change" && <button className="pill-act" onClick={tap(open)}>Review Change</button>}
              {o.kind === "cancelled_filed" && <button className="pill-act" onClick={tap(() => void openOnEvent(o, "cancelled"))}>Review Change</button>}
              {o.kind === "filed" && added[c.id]?.undo && <button className="pill-act" onClick={tap(() => void undoAdd(c.id))}>Undo</button>}
            </div>
          );
        })}
        {failed && <div className="conn-meta msg-stands-act">{failed}</div>}
      </div>
      {sheet && sheet.kind === "fill" && (
        <MeetingEventSheet
          mode="new"
          initial={seedFor(sheet.offer.candidate)}
          onSave={(d) => void saveFill(sheet.offer, d)}
          onCancel={() => setSheet(null)}
        />
      )}
      {sheet && sheet.kind === "review" && (
        <MeetingEventSheet
          mode="edit"
          initial={sheet.event}
          onSave={(d) => void saveReview(sheet.offer, d)}
          onCancel={() => setSheet(null)}
        />
      )}
      {sheet && sheet.kind === "cancelled" && (
        <MeetingEventSheet
          mode="edit"
          initial={sheet.event}
          onSave={(d) => void saveCancelled(sheet.offer, d)}
          onDelete={() => void removeFiled(sheet.offer)}
          onCancel={() => setSheet(null)}
        />
      )}
    </>
  );
}

/**
 * The person picked AM or PM for the hour the sender named. The day is the
 * one the sentence settled; the length is the default, and still says so.
 */
function meridiemPatch(c: MeetingCandidate, hour: number, minute: number, ap: "am" | "pm"): Partial<MeetingCandidate> {
  const h24 = (hour % 12) + (ap === "pm" ? 12 : 0);
  const start = hhmm(h24, minute);
  const endMin = Math.min(24 * 60 - 1, h24 * 60 + minute + 60);
  const end = hhmm(Math.floor(endMin / 60), endMin % 60);
  return { start, end, missing: c.missing.filter((m) => m !== "meridiem" && m !== "time"), durationSource: "default" };
}
