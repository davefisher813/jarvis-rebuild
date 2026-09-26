import { sourceLabel, type Source } from "./provenance";
import { shortDateFromMs } from "./dateFormat";

// The one provenance renderer (addendum item 8). A single meta line; a button
// only when the caller can actually open the source, otherwise a plain fact.
// Renders nothing for entities without a source, so hand-made rows stay clean.
//
// `compact` drops the timestamp (2026-09-09). It is for the one caller that
// shares a line rather than owning one -- the task row, where provenance moved
// onto the meta line so it would stop being a third line against contract 4.1.
// Everything else, the sheet above all, keeps the full fact: that is where a
// date is read on purpose rather than glanced at.
//
// TWO FACTS, NOT ONE STRING (§AM F3/F5, 2026-09-26). The full line used to be
// sourceLine()'s "From Smart Paste · 2:14 PM": a middot typed into a meta
// line, and a neutral time in the same grey and case as the words before it.
// The words and the time are separate facts now. The separator between them
// is the one every facts line draws in CSS, and the time takes the neutral
// date's small caps, so it stays apart from the words even where the line
// has already spent its one grey.
export default function Provenance({ source, onOpen, compact = false }: { source?: Source; onOpen?: () => void; compact?: boolean }) {
  const label = sourceLabel(source);
  if (!label || !source) return null;
  const when = compact ? null : whenOf(source);
  const line = when
    ? <><span className="fact">{label}</span><span className="fact date">{when}</span></>
    : label;
  if (onOpen && source.ref) {
    return (
      <button type="button" className="prov-line prov-link" onClick={onOpen}>
        {line}
      </button>
    );
  }
  return <div className="prov-line">{line}</div>;
}

// The time half of the fact: the clock time when it happened today, the date
// when it did not. The same reading provenance.ts's sourceLine() gives, which
// still joins the two halves for the callers that want one string.
function whenOf(source: Source, now: number = Date.now()): string {
  const d = new Date(source.ts);
  const n = new Date(now);
  const today = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : shortDateFromMs(source.ts);
}
