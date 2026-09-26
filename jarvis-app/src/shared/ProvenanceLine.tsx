import { sourceLabel, sourceWhen, type Source } from "./provenance";

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
// has already spent its one grey. Both halves come from provenance.ts
// (sourceLabel, sourceWhen), so this line and any other reader of a source
// agree on the words and on the same-day clock-time-or-date reading.
export default function Provenance({ source, onOpen, compact = false }: { source?: Source; onOpen?: () => void; compact?: boolean }) {
  const label = sourceLabel(source);
  if (!label || !source) return null;
  const when = compact ? null : sourceWhen(source);
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
