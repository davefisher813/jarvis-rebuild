import { useState } from "react";
import { FileText, PenLine, Search } from "lucide-react";
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

// Notes is a tab-level surface: there is deliberately no back button on the
// list (audit 2026-08-10 removed a dead onBack prop no parent ever passed).
export default function NotesList({
  notes,
  onOpen,
  onNewNote,
}: {
  notes: NoteListItem[];
  onOpen?: (id: string) => void;
  onNewNote?: () => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = query ? notes.filter((n) => n.title.toLowerCase().includes(query)) : notes;
  return (
    <div className="screen">
      <div className="nav-bar">
        <span></span>
        <button className="nav-action" onClick={onNewNote} aria-label="New note">
          <PenLine className="ic" />
        </button>
      </div>
      <div className="nav-large">Notes</div>

      <div className="sub-bar">
        <div className="search-bar">
          <Search className="ic" />
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {/* V2 anatomy: the section carries the yellow note tile; each row's
          category tile is its leading visual, so no RowIcon on rows. */}
      <div className="sec-head"><div className="sec-left"><div className="sec-ico nav-tile-yellow"><FileText className="ic" /></div><div className="sec-title">All Notes</div></div></div>
      <div className="pad-x">
        <div className="card">
          {shown.map((n) => (
            <div className="row" key={n.id} onClick={() => onOpen?.(n.id)}>
              <div className={"proj-icon cat-bg-" + catColor(n.category)}>
                <FileText className="ic" />
              </div>
              <div className="conn-name truncate">{n.title}</div>
              <div className="conn-meta">{n.date}</div>
              <div className="chev"></div>
            </div>
          ))}
          {query && shown.length === 0 && (
            <div className="row"><div className="conn-name">No notes match &ldquo;{q.trim()}&rdquo;</div></div>
          )}
        </div>
      </div>
    </div>
  );
}
