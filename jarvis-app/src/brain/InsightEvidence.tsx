import { useEffect, useState, type ReactNode } from "react";
import type { Evidence } from "../gym/insights";
import { shortDate } from "../shared/dateFormat";

// THE EVIDENCE BEHIND A FINDING (Part 3 wave 3, 2026-09-13; handoff
// acceptance 13: "every real insight can trace its numbers to logs"). One
// quiet pill on every insight card opens the same seven rows: what kind of
// finding it is (Observation, Exploratory Pattern, Program Comparison), the
// dates it read, how many records, how the number was made, what it shows,
// what it does not show, and the minimum it had to clear and why. Nothing
// here is computed; it is the finding's own receipt, written by the
// derivation that produced it.
//
// Explain is the AI foundation Dave asked for (question 11): it hands these
// same rows to the model and shows the words back, under a line that says
// where they came from. The model is given no other number and asked to
// invent none; the answer explains, it never adds a record, a cause or a
// confidence.
//
// THE NOTE GOES UNDER THE CARD (§AK, 2026-09-26: "Caps is for a label, never
// a sentence"). The line saying where the words came from is a sentence, so
// it is not an 11px caps cite inside the card any more: it is the quiet note
// under the card, at the card's own edge as settings' Foot is. A component
// inside a card cannot draw below it, so the explain seam comes with a
// second half: onShown tells the card's owner when the explanation is on
// screen, and InsightCard below draws the note. The two travel as one prop,
// so the words can never be shown without the note that says what they are.
export default function InsightEvidence({ evidence, explain }: {
  evidence: Evidence;
  explain?: { run?: (evidence: Evidence) => Promise<string>; onShown: (shown: boolean) => void };
}) {
  const [open, setOpen] = useState(false);
  const [explained, setExplained] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = explain?.run;
  const onShown = explain?.onShown;
  const shown = open && explained != null;
  useEffect(() => { onShown?.(shown); }, [shown, onShown]);
  const ask = async () => {
    if (!run || busy) return;
    setBusy(true);
    try { setExplained((await run(evidence)).trim() || null); }
    catch { setExplained(null); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className="ins-acts">
        <button type="button" className="pill-act pill-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide Evidence" : "Evidence"}</button>
        {open && run && !explained && (
          <button type="button" className="pill-act pill-quiet" disabled={busy} onClick={() => void ask()}>{busy ? "Explaining" : "Explain"}</button>
        )}
      </div>
      {open && (
        <div className="ins-rows ins-ev">
          <div className="ins-row"><span className="ins-k">Kind</span><span className="ins-sub">{evidence.label}</span></div>
          <div className="ins-row"><span className="ins-k">Range</span><span className="ins-sub">{shortDate(evidence.from)} to {shortDate(evidence.to)}</span></div>
          <div className="ins-row"><span className="ins-k">Records</span><span className="ins-sub">{evidence.records}</span></div>
          <div className="ins-row"><span className="ins-k">Method</span><span className="ins-sub">{evidence.method}</span></div>
          <div className="ins-row"><span className="ins-k">Shows</span><span className="ins-sub">{evidence.supports}</span></div>
          <div className="ins-row"><span className="ins-k">Does Not Show</span><span className="ins-sub">{evidence.doesNot}</span></div>
          {/* A rule we chose, kept visibly apart from the method and from
              the cited source above the pill. */}
          {evidence.convention && (
            <div className="ins-row"><span className="ins-k">Our Convention</span><span className="ins-sub">{evidence.convention}</span></div>
          )}
          {evidence.minimum && (
            <div className="ins-row"><span className="ins-k">Minimum</span><span className="ins-sub">{evidence.minimum.name} {evidence.minimum.value}, {evidence.minimum.reason}</span></div>
          )}
          {explained && <div className="ins-line">{explained}</div>}
        </div>
      )}
    </>
  );
}

/** Where an explanation's words came from, drawn under the card. */
export const EXPLAIN_NOTE = "Explanation from your records + AI, adding nothing to the rows above.";

/** An insight card, its receipt, and the note it owes the reader.
 *
 *  The note is the card's one sentence, drawn UNDER the card as a bare
 *  .input-hint, never inside it: inside, it was a second grey under the
 *  finding's own line (§AK R1), and in caps it was a sentence shouting (§AK,
 *  2026-09-26). When the explanation is open its note joins the same line,
 *  so a card never grows two notes under it.
 *
 *  NO .pad-x OF ITS OWN. The card is drawn bare too: the caller's one .pad-x
 *  insets the card and its note together, so both sit 16px from the screen
 *  edge and the note lines up with the card's edge, where settings' Foot
 *  puts it beside its Card. A .pad-x here would stack on the caller's and
 *  push the note to 32px, inside the card's edge. */
export function InsightCard({ evidence, onExplain, note, children }: {
  evidence?: Evidence | null;
  onExplain?: (evidence: Evidence) => Promise<string>;
  note?: ReactNode;
  children: ReactNode;
}) {
  const [explainShown, setExplainShown] = useState(false);
  return (
    <>
      <div className="card ins-card rep-gap">
        {children}
        {evidence && <InsightEvidence evidence={evidence} explain={{ run: onExplain, onShown: setExplainShown }} />}
      </div>
      {(note || (evidence && explainShown)) && (
        <div className="input-hint">
          {note}{note && evidence && explainShown ? " " : null}{evidence && explainShown ? EXPLAIN_NOTE : null}
        </div>
      )}
    </>
  );
}
