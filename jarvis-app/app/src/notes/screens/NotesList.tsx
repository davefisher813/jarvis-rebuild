import { FileText, PenLine } from "lucide-react";
import TabBar from "../../shell/TabBar";

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
}: {
  notes: NoteListItem[];
  onOpen?: (id: string) => void;
  onNewNote?: () => void;
}) {
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
          <div className="ic"></div>
          <input placeholder="Search" />
        </div>
      </div>

      <div className="pad-x">
        <div className="card">
          {notes.map((n) => (
            <div className="row" key={n.id} onClick={() => onOpen?.(n.id)}>
              <div className={"proj-icon cat-bg-" + n.category}>
                <FileText className="ic" />
              </div>
              <div className="conn-name truncate">{n.title}</div>
              <div className="conn-meta">{n.date}</div>
              <div className="chev"></div>
            </div>
          ))}
        </div>
      </div>

      <TabBar active="more" />
    </div>
  );
}
