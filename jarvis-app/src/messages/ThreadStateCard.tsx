import { useState } from "react";
import { THREAD_STATE_LABEL, type Brief } from "./brief";
import EvidenceChip from "./EvidenceChip";
import type { Evidence } from "./evidence";
import type { Bucket } from "./triage";
import { haptics } from "../shared/haptics";

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
  const has = !!brief && (!!brief.state || !!brief.agreed?.length || !!brief.unresolved?.length || !!brief.deadline || !!brief.next);
  if (!has && !brief?.decision && !onOverride) return null;
  return (
    <div className="card msg-summary">
      <div className="eyebrow">Where This Stands</div>
      {/* E-16: two capsules that answer the question for THIS thread only.
          The sender's other mail is untouched and no rule is written; the
          chips under the messages are still the only way to set one. */}
      {onOverride && (
        <div className="msg-chips msg-override">
          <button className={"chip" + (override === "needs_you" ? " on" : "")} onClick={() => { haptics.selection(); onOverride(override === "needs_you" ? null : "needs_you"); }}>Needs Me</button>
          <button className={"chip" + (override === "worth_knowing" ? " on" : "")} onClick={() => { haptics.selection(); onOverride(override === "worth_knowing" ? null : "worth_knowing"); }}>Not for Me</button>
        </div>
      )}
      {brief?.state && (
        <div className="row">
          <div className="row-grow"><div className="conn-name">{THREAD_STATE_LABEL[brief.state]}</div></div>
          {has && (
            <button className="quiet-action" onClick={() => { haptics.selection(); setOpen(!open); }}>
              {open ? "Less" : "More"}
            </button>
          )}
        </div>
      )}
      {open && brief && (
        <div className="pad-x">
          {brief.deadline && (
            <div className="line-between">
              <span className="conn-meta">By</span>
              <EvidenceChip className="msg-due" label={brief.deadline} evidence={evidence} {...(onOpenSource ? { onOpenSource } : {})} />
            </div>
          )}
          {brief.next && <div className="conn-meta">Next: {brief.next}</div>}
          {brief.agreed?.length ? (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Agreed</span></div>
              {brief.agreed.map((a) => <div className="conn-meta" key={a}>{a}</div>)}
            </>
          ) : null}
          {brief.unresolved?.length ? (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Still Open</span></div>
              {brief.unresolved.map((u) => <div className="conn-meta" key={u}>{u}</div>)}
            </>
          ) : null}
        </div>
      )}
      {/* The one-tap route into the Decisions log. The sentence is the
          thread's own words, shown before anything is written, and the tap
          opens the capture sheet rather than filing it. */}
      {brief?.decision && onRemember && (
        <div className="row">
          <div className="row-grow">
            <div className="conn-name">Worth Remembering?</div>
            <div className="conn-meta">{brief.decision}</div>
          </div>
          <button className="pill-act" onClick={() => { haptics.selection(); onRemember(brief.decision!); }}>Keep It</button>
        </div>
      )}
    </div>
  );
}
