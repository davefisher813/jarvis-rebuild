import { useState } from "react";
import { THREAD_STATE_LABEL, type Brief, type ConfirmedMeeting } from "./brief";
import EvidenceChip from "./EvidenceChip";
import type { Evidence } from "./evidence";
import type { Bucket } from "./triage";
import { haptics } from "../shared/haptics";
import { rowDoor } from "../shared/rowDoor";
import { dayPhrase } from "../money/bills";
import { fmtTime, todayISO } from "../schedule/calendar";

// WHERE THIS STANDS (UP-MIND-19, Email E9, 5.6 and 5.13; Brain build order 5).
//
// Opening a fourteen-message thread should answer "where does this stand"
// before showing a single message. It never did: the summary was one line
// about what the mail wanted, and everything else (what was agreed, what is
// still open, the deadline somebody named, the vendor picked in message
// nine) was in the thread and nowhere else.
//
// Three rules hold the card up:
//
//   - ANYTHING THE MODEL COULD NOT ESTABLISH IS ABSENT. brief.ts drops a
//     state outside its closed vocabulary, an empty list, a deadline longer
//     than a phrase. A card that hedges is a card you have to check, which
//     is the trip it exists to save.
//   - COLLAPSED BY DEFAULT from the inbox. The state line always shows; the
//     detail opens on a tap, because most threads are opened to read them.
//   - NOTHING WRITES A DECISION WITHOUT THE TAP. "Worth remembering?" is an
//     offer with the sentence in it, and the tap opens the capture sheet
//     prefilled. The app never files a decision on its own.
//
// REBUILT 2026-09-16 (Dave, on a screenshot: "the email 'where this stands'
// section look[s] awful"). It had grown four different text shapes stacked
// with no order to them: two correction chips sat directly under the eyebrow
// where they read as the card's headline rather than as a correction to it,
// the state fought a More button for the same row, Agreed wore a full
// section head with a dotted rule inside a card barely wider than the rule,
// and an inner pad-x indented the detail against everything above it.
//
// The order is now by what the reader came for: WHAT IS TRUE (the state and
// its deadline, as one facts line), WHAT TO DO (the calendar offer, the
// decision offer), WHAT WAS SAID (agreed and open, behind More), and only
// then HOW TO CORRECT IT. Corrections go last on purpose: they are the
// rarest thing anyone does here and they were sitting first.
export default function ThreadStateCard({
  brief,
  evidence,
  defaultOpen = false,
  onRemember,
  onOpenSource,
  override,
  onOverride,
  onAddToCalendar,
  calendarState = "none",
  onOpenCalendar,
}: {
  /** Null when the pass established nothing: the card then draws only the
   *  two correction capsules, if it has them, and nothing else. */
  brief: Brief | null;
  /** UP-MIND-12: the sentence the claim came from, when one was anchored. */
  evidence?: Evidence;
  /** True from the ledger, where this IS the landing view. */
  defaultOpen?: boolean;
  /** Opens the Decisions capture sheet, prefilled with the sentence. */
  onRemember?: (decision: string) => void;
  onOpenSource?: (sourceMsgId: string) => void;
  /** E-16 (Dave's picks 2026-09-12): this thread's own correction to
   *  triage, when he has made one. Not the sender rule: that stays on the
   *  chips below the messages, and this touches no other thread. */
  override?: Bucket | null;
  /** Needs Me / Not for Me. Tapping the one already set clears it. */
  onOverride?: (bucket: "needs_you" | "worth_knowing" | null) => void;
  /** THE TAP (2026-09-16). Absent means no calendar is reachable, and the
   *  card then states the time without offering to file it. */
  onAddToCalendar?: (m: ConfirmedMeeting) => void;
  /** Whether this thread's meeting is already on the calendar. "added" is
   *  the receipt after the tap; "already" is one found on load, so a second
   *  visit cannot file the same interview twice. */
  calendarState?: "none" | "added" | "already";
  /** Opens the event this thread already put on the calendar. */
  onOpenCalendar?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggleOpen = () => { haptics.selection(); setOpen((v) => !v); };
  const detail = !!brief && (!!brief.agreed?.length || !!brief.unresolved?.length);
  const meeting = brief?.meeting;
  const has = !!brief && (!!brief.state || detail || !!brief.deadline || !!brief.next || !!meeting);
  if (!has && !brief?.decision && !onOverride) return null;
  const onCal = calendarState !== "none";
  return (
    <div className="card msg-summary">
      <div className="eyebrow">Where This Stands</div>

      {/* WHAT IS TRUE. The state, the deadline and the next move are one
          facts line, which is the app's own shape for per-row data that is
          read rather than tapped. They were three stacked text sizes. */}
      {(brief?.state || brief?.deadline || brief?.next) && (
        <div className="facts msg-stands-facts">
          {brief.state && <span className="fact strong">{THREAD_STATE_LABEL[brief.state]}</span>}
          {brief.deadline && (
            <span className="fact">
              <EvidenceChip className="msg-stands-by" label={"By " + brief.deadline} evidence={evidence} {...(onOpenSource ? { onOpenSource } : {})} />
            </span>
          )}
          {brief.next && <span className="fact">{"Next: " + brief.next}</span>}
        </div>
      )}

      {/* WHAT TO DO. The time the thread actually settled on, and one tap to
          put it in the calendar. Nothing is written until that tap: reading
          his mail is what earns the offer, not the right to file it. */}
      {meeting && (
        <div className="row msg-stands-act" {...(onCal
          ? (onOpenCalendar ? rowDoor(() => { haptics.selection(); onOpenCalendar(); }) : {})
          : (onAddToCalendar ? rowDoor(() => { haptics.selection(); onAddToCalendar(meeting); }) : {}))}>
          <div className="row-grow">
            <div className="conn-name">{meeting.title}</div>
            <div className="conn-meta">{whenLine(meeting)}</div>
          </div>
          {onCal ? (
            <span className="fact good msg-stands-done">{calendarState === "added" ? "Added" : "On your calendar"}</span>
          ) : onAddToCalendar ? (
            <button className="pill-act" onClick={(e) => { e.stopPropagation(); haptics.selection(); onAddToCalendar(meeting); }}>
              Add to Calendar
            </button>
          ) : null}
        </div>
      )}

      {/* The one-tap route into the Decisions log. The sentence is the
          thread's own words, shown before anything is written, and the tap
          opens the capture sheet rather than filing it. */}
      {brief?.decision && onRemember && (
        <div className="row msg-stands-act" {...rowDoor(() => { haptics.selection(); onRemember(brief.decision!); })}>
          <div className="row-grow">
            <div className="conn-name">Worth Remembering?</div>
            <div className="conn-meta">{brief.decision}</div>
          </div>
          <button className="pill-act" onClick={(e) => { e.stopPropagation(); haptics.selection(); onRemember(brief.decision!); }}>Keep It</button>
        </div>
      )}

      {/* WHAT WAS SAID. Behind one control, which now owns its own row
          instead of sharing one with the state it was overlapping. */}
      {detail && (
        <>
          <div className="row msg-stands-more" {...rowDoor(toggleOpen)}>
            <div className="row-grow"><div className="conn-meta">{open ? "Hide the detail" : "What was said"}</div></div>
            <span className="pill-act">{open ? "Less" : "More"}</span>
          </div>
          {open && (
            <div className="msg-stands-detail">
              {brief.agreed?.length ? (
                <>
                  <div className="msg-stands-head">Agreed</div>
                  {brief.agreed.map((a) => <div className="conn-meta" key={a}>{a}</div>)}
                </>
              ) : null}
              {brief.unresolved?.length ? (
                <>
                  <div className="msg-stands-head">Still Open</div>
                  {brief.unresolved.map((u) => <div className="conn-meta" key={u}>{u}</div>)}
                </>
              ) : null}
            </div>
          )}
        </>
      )}

      {/* HOW TO CORRECT IT, last. E-16: two capsules that answer the
          question for THIS thread only. The sender's other mail is
          untouched and no rule is written; the chips under the messages are
          still the only way to set one. */}
      {onOverride && (
        <div className="msg-stands-fix">
          <span className="conn-meta">Sorted wrong?</span>
          <div className="msg-chips msg-override">
            <button className={"chip" + (override === "needs_you" ? " on" : "")} onClick={() => { haptics.selection(); onOverride(override === "needs_you" ? null : "needs_you"); }}>Needs Me</button>
            <button className={"chip" + (override === "worth_knowing" ? " on" : "")} onClick={() => { haptics.selection(); onOverride(override === "worth_knowing" ? null : "worth_knowing"); }}>Not for Me</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The meeting in the app's own clock words, never the model's phrasing. */
export function whenLine(m: ConfirmedMeeting, today = todayISO()): string {
  const s = fmtTime(m.start);
  const e = fmtTime(m.end);
  return dayPhrase(m.date, today) + " · " + s.time + " " + s.ap + " to " + e.time + " " + e.ap;
}
