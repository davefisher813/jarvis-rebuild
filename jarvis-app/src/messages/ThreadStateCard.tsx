import { useState } from "react";
import { THREAD_STATE_LABEL, type Brief } from "./brief";
import EvidenceChip from "./EvidenceChip";
import type { Evidence } from "./evidence";
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
}: {
  brief: Brief;
  /** UP-MIND-12: the sentence the claim came from, when one was anchored. */
  evidence?: Evidence;
  /** True from the ledger, where this IS the landing view. */
  defaultOpen?: boolean;
  /** Opens the Decisions capture sheet, prefilled with the sentence. */
  onRemember?: (decision: string) => void;
  onOpenSource?: (sourceMsgId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const has = !!brief.state || !!brief.agreed?.length || !!brief.unresolved?.length || !!brief.deadline || !!brief.next;
  if (!has && !brief.decision) return null;
  return (
    <div className="card msg-summary">
      <div className="eyebrow">Where This Stands</div>
      {brief.state && (
        <div className="row">
          <div className="row-grow"><div className="conn-name">{THREAD_STATE_LABEL[brief.state]}</div></div>
          {has && (
            <button className="quiet-action" onClick={() => { haptics.selection(); setOpen(!open); }}>
              {open ? "Less" : "More"}
            </button>
          )}
        </div>
      )}
      {open && (
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
      {brief.decision && onRemember && (
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
