import { useState } from "react";
import PageHeader, { BarAction } from "../../shared/PageHeader";
import { FileText, PenLine, Search } from "../../shared/icons";
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
      {/* Library chassis (Design 2, approved 2026-08-18): pencil rides the
          bar, search under the title, notes as full-bleed library rows with
          the category color on a bare glyph. */}
      <PageHeader title="Notes" actions={<BarAction label="New Note" onClick={onNewNote}><PenLine className="ic" /></BarAction>}>
        <div className="sub-bar">
          <div className="search-bar">
            <Search className="ic" />
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </PageHeader>

      <div className="sh2"><span className="t">All Notes</span><span className="n">{shown.length}</span></div>
      {shown.map((n) => (
        <div className="lib-row" role="button" tabIndex={0} key={n.id} onClick={() => onOpen?.(n.id)}>
          <div className={"lib-ico cat-fg-" + catColor(n.category)}><FileText className="ic" /></div>
          <div className="lib-stack">
            <div className="lib-name">{n.title}</div>
            <div className="lib-sub">{n.date}</div>
          </div>
          <div className="chev"></div>
        </div>
      ))}
      {query && shown.length === 0 && (
        <div className="lib-row"><div className="lib-name">No notes match &ldquo;{q.trim()}&rdquo;</div></div>
      )}
    </div>
  );
}
