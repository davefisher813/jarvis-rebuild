import { useState } from "react";
import { THREAD_STATE_LABEL, type Brief } from "./brief";
import EvidenceChip from "./EvidenceChip";
import type { Evidence } from "./evidence";
import type { Bucket } from "./triage";
import { deadlineTone } from "./home";
import { haptics } from "../shared/haptics";
import { rowDoor } from "../shared/rowDoor";

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
// its deadline, as one facts line), WHAT TO DO (the decision offer), WHAT WAS
// SAID (agreed and open, behind More), and only then HOW TO CORRECT IT.
// Corrections go last on purpose: they are the rarest thing anyone does here
// and they were sitting first.
//
// THE CALENDAR OFFER LEFT THIS CARD (2026-09-29). It lived here, in a card that
// is collapsed by default, and the one action the whole feature exists for was
// the one you had to open something to reach. It is MeetingFinishCard now,
// above the messages, and this card no longer has a calendar action of its
// own: two places offering the same write is how it gets offered twice.
export default function ThreadStateCard({
  brief,
  evidence,
  defaultOpen = false,
  onRemember,
  onOpenSource,
  override,
  onOverride,
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
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggleOpen = () => { haptics.selection(); setOpen((v) => !v); };
  const detail = !!brief && (!!brief.agreed?.length || !!brief.unresolved?.length);
  const has = !!brief && (!!brief.state || detail || !!brief.deadline || !!brief.next);
  if (!has && !brief?.decision && !onOverride) return null;
  return (
    <div className="card msg-summary">
      <div className="eyebrow">Where This Stands</div>

      {/* WHAT IS TRUE. The state, the deadline and the next move are one
          facts line, which is the app's own shape for per-row data that is
          read rather than tapped. They were three stacked text sizes. */}
      {(brief?.state || brief?.deadline || brief?.next) && (
        <div className="facts msg-stands-facts">
          {brief.state && <span className="fact strong">{THREAD_STATE_LABEL[brief.state]}</span>}
          {/* A deadline is a date with a meaning (§AM R8), never a second
              grey beside Next. Its colour is the one deadline rule the
              Today card reads too (deadlineTone in home.ts): today,
              tomorrow or a bare clock ("by 3 PM", which is today) is due,
              amber; later, or a phrase no one can place, is a neutral date
              in small caps. The mail rail reads the same phrase on a wider
              window of its own, which is the rail's to keep. A stated
              deadline is due, never late: the phrase cannot say whether it
              has passed. */}
          {brief.deadline && (
            <span className={"fact " + deadlineTone(brief.deadline)}>
              <EvidenceChip className="msg-stands-by" label={"By " + brief.deadline} evidence={evidence} {...(onOpenSource ? { onOpenSource } : {})} />
            </span>
          )}
          {brief.next && <span className="fact">{"Next: " + brief.next}</span>}
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
          <div className="chev" />
        </div>
      )}

      {/* WHAT WAS SAID. Behind one control, which now owns its own row
          instead of sharing one with the state it was overlapping. */}
      {detail && (
        <>
          <div className="row msg-stands-more" {...rowDoor(toggleOpen)}>
            <div className="row-grow"><div className="conn-meta">{open ? "Hide the Detail" : "What Was Said"}</div></div>
            <div className="chev" />
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
