import { Mail } from "../shared/icons";
import type { EmailSection } from "./emailSections";

// THE SECTION CHIPS ON THE EMAIL TAB (2026-09-29).
//
// "All" and one chip per section the person made, in the app's own chip row
// (.msg-chips and .chip, the same as For You, All and Drafts above it). It
// draws NOTHING until at least one section exists, so an inbox with no
// sections is exactly the inbox it was. A chip is a local filter over mail
// already loaded: picking one calls onChange and nothing else. No AI, no
// Gmail. The screen decides what "changing section" also resets (a selection),
// through onChange.

export default function SectionFilterBar({ sections, activeId, onChange }: {
  sections: readonly EmailSection[];
  activeId: string | null;
  onChange: (id: string | null) => void;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="pad-x msg-chips" role="group" aria-label="Sections">
      <button type="button" aria-label="All Sections" aria-pressed={activeId === null} className={"chip" + (activeId === null ? " on" : "")} onClick={() => onChange(null)}>All</button>
      {sections.map((s) => (
        <button type="button" key={s.id} aria-pressed={activeId === s.id} className={"chip" + (activeId === s.id ? " on" : "")} onClick={() => onChange(s.id)}>{s.name}</button>
      ))}
    </div>
  );
}

// A section that matches nothing in the mail loaded so far. Only what is
// loaded was searched, so it says that, and while Gmail has more pages the way
// to fetch them stays right here.
export function SectionNoMatch({ atEnd, busy, onLoadMore, onShowAll }: {
  atEnd: boolean;
  busy: boolean;
  onLoadMore: () => void;
  onShowAll: () => void;
}) {
  return (
    <div className="pad-x"><div className="card"><div className="empty-state">
      <div className="empty-icon"><Mail className="ic cat-fg-teal" /></div>
      <div className="empty-title">{atEnd ? "No Matches" : "No Matches in Loaded Mail"}</div>
      {!atEnd && <button className="quiet-action" disabled={busy} aria-busy={busy} onClick={onLoadMore}>Load More</button>}
      <button className="quiet-action" onClick={onShowAll}>Show All Mail</button>
    </div></div></div>
  );
}
