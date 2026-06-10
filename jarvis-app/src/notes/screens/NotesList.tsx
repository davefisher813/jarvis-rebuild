import { FileText, PenLine } from "lucide-react";
import { catColor } from "../../shared/categories";

// Matches locked frame #46 "List". The real iOS chrome (status bar, home
// indicator) is drawn by the device, so this uses the canonical .screen
// safe-area container in place of the preview's .device > .scroll wrapper.

export interface NoteListItem {
  id: string;
  title: string;
  date: string;
  category: string; // drives the category tile color
}

export default function NotesList({
  notes,
  onOpen,
  onNewNote,
  onBack,
}: {
  notes: NoteListItem[];
  onOpen?: (id: string) => void;
  onNewNote?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        {onBack ? (
          <button className="nav-back" aria-label="Back" onClick={onBack}>
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        ) : (
          <span></span>
        )}
        <button className="nav-action" onClick={onNewNote} aria-label="New note">
          <PenLine className="ic" />
        </button>
      </div>
      <div className="nav-large">Notes</div>

      <div className="sub-bar">
        <div className="search-bar">
          <div className="ic"></div>
          <input placeholder="Search" />
        </div>
      </div>

      <div className="pad-x">
        <div className="card">
          {notes.map((n) => (
            <div className="row" key={n.id} onClick={() => onOpen?.(n.id)}>
              <div className={"proj-icon cat-bg-" + catColor(n.category)}>
                <FileText className="ic" />
              </div>
              <div className="conn-name truncate">{n.title}</div>
              <div className="conn-meta">{n.date}</div>
              <div className="chev"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
