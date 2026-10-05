import { watchingCount, type Readiness } from "../readiness";
import { lineCase } from "../../shared/casing";

// A READINESS ROW OPENS ITS OWN DETAIL (audit 2026-09-29). Tapping a row on
// What JARVIS Knows -> Readiness used to open the Add One Thing form: a row
// that says "Waiting" answered with a blank text box. The row is a detector
// JARVIS is still counting for, so what it opens is that count: the word, the
// evidence against the gate, what is still missing, and the way to add the
// fact yourself (Tell JARVIS, which is the form, one tap on purpose).
//
// It reads only the Readiness row it was handed, the same object the panel
// draws from, so the sheet and the row cannot disagree.
//
// SHORT ENOUGH TO READ IN ONE GLANCE (Dave 2026-10-05, the review: "Enough Evidence, Waiting f..." cut mid-phrase in the
// one place that exists to say it). Each state is a few words, and the facts line wraps rather than ending in an
// ellipsis (components.css, a sheet's .facts), so neither fact can be cut.
function missingLine(r: Readiness): string {
  if (r.state === "known") return "JARVIS Already Knows This";
  if (r.state === "muted") return "Switched Off";
  if (r.state === "ready") return "Ready to Accept";
  const short = Math.max(0, r.need - r.have);
  return lineCase(`${short} more to go`);
}

// WHAT TELLING IT DOES, IN A WARM LINE (the round 2 review: "a bare stub: it never says what JARVIS has noticed, what telling it
// does, or what the form will ask"). One sentence per state, a field note (.input-hint, the one class for it), so the primary
// is never a commitment to something unexplained.
function whatItMeans(r: Readiness): string {
  if (r.state === "known") return "JARVIS already holds this one, so tell it again only if it has changed";
  if (r.state === "muted") return "You corrected this twice and JARVIS stopped offering it, but you can still tell it yourself";
  if (r.state === "ready") return "JARVIS has seen enough to say this out loud, so tell it in your own words and it will remember";
  if (r.state === "close") return "JARVIS is nearly sure, so tell it now in your own words or let a few more days settle it";
  return "JARVIS is still watching for a pattern, and you can skip the wait by telling it yourself";
}

export default function ReadinessSheet({ r, onTell, onClose }: { r: Readiness; onTell: () => void; onClose: () => void }) {
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label={r.label} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {/* ONE STATE ON THE SHEET, AND IT IS THE FACT'S (the round 2 review: an amber CLOSE kicker over an amber "Ready to
            Accept" said the same thing twice, and read as a button). The kicker names the sheet; the facts line below says where it stands. */}
        <div className="grp"><div className="eyebrow">Readiness</div></div>
        <div className="pad-x sheet-form">
          <div className="strand-head">{r.label}</div>
          {/* 2026-10-05 (the catalog gate): three grey lines stacked under the head
              (the count, the rule, what is missing) were three greys on one record
              (R1). It is one facts line now: the count is a number with no state, so
              white; what is missing wears its state (known is green, ready needs you
              so amber, a count still short is the one grey). The rule that decides
              the count is methodology, so it sits behind the labelled disclosure the
              Classify sheet uses for its counting convention, in Title Case. */}
          <div className="facts">
            <span className="fact"><b>{watchingCount(r)}</b></span>
            <span className={"fact" + (r.state === "known" ? " good" : r.state === "ready" ? " warn" : "")}>{missingLine(r)}</span>
          </div>
          <div className="input-hint">{whatItMeans(r)}</div>
          {r.detail && (
            <details className="exp-more" open>
              <summary>How It Is Counted</summary>
              <div className="conn-meta">{lineCase(r.detail)}</div>
            </details>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={onTell}>Tell JARVIS</button>
          {/* Done, never Close: Close is the eyebrow's own state word (nearly enough evidence), and one word that means two things
            180px apart reads as a mistake (Dave 2026-10-05, the review). */}
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
