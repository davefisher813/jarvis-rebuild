import { sourceLine, type Source } from "./provenance";

// The one provenance renderer (addendum item 8). A single meta line; a button
// only when the caller can actually open the source, otherwise a plain fact.
// Renders nothing for entities without a source, so hand-made rows stay clean.
export default function Provenance({ source, onOpen }: { source?: Source; onOpen?: () => void }) {
  const line = sourceLine(source);
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
