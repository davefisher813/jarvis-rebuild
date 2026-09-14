import { useState } from "react";
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
export default function InsightEvidence({ evidence, onExplain }: {
  evidence: Evidence;
  onExplain?: (evidence: Evidence) => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [explained, setExplained] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const explain = async () => {
    if (!onExplain || busy) return;
    setBusy(true);
    try { setExplained((await onExplain(evidence)).trim() || null); }
    catch { setExplained(null); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className="ins-acts">
        <button type="button" className="pill-act pill-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide Evidence" : "Evidence"}</button>
        {open && onExplain && !explained && (
          <button type="button" className="pill-act pill-quiet" disabled={busy} onClick={() => void explain()}>{busy ? "Explaining" : "Explain"}</button>
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
          {evidence.minimum && (
            <div className="ins-row"><span className="ins-k">Minimum</span><span className="ins-sub">{evidence.minimum.name} {evidence.minimum.value} · {evidence.minimum.reason}</span></div>
          )}
          {explained && (
            <>
              <div className="ins-line">{explained}</div>
              <div className="ins-cite">From your records + AI · Explains the rows above, adds nothing to them</div>
            </>
          )}
        </div>
      )}
    </>
  );
}
