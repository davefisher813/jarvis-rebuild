import { sourceLine, sourceLabel, type Source } from "./provenance";

// The one provenance renderer (addendum item 8). A single meta line; a button
// only when the caller can actually open the source, otherwise a plain fact.
// Renders nothing for entities without a source, so hand-made rows stay clean.
//
// `compact` drops the timestamp (2026-09-09). It is for the one caller that
// shares a line rather than owning one -- the task row, where provenance moved
// onto the meta line so it would stop being a third line against contract 4.1.
// Everything else, the sheet above all, keeps the full fact: that is where a
// date is read on purpose rather than glanced at.
export default function Provenance({ source, onOpen, compact = false }: { source?: Source; onOpen?: () => void; compact?: boolean }) {
  const line = compact ? sourceLabel(source) : sourceLine(source);
  if (!line) return null;
  if (onOpen && source?.ref) {
    return (
      <button type="button" className="prov-line prov-link" onClick={onOpen}>
        {line}
      </button>
    );
  }
  return <div className="prov-line">{line}</div>;
}
