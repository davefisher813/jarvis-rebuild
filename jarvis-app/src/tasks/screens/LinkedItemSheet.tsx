import { useState } from "react";
import { createPortal } from "react-dom";
import type { LinkedItem, LinkedType } from "../../notes/types";
import { linkedTypeWord } from "../reminderHistory";
import { pressable } from "../../shared/pressable";
import { Search, ListChecks, FileText, CalendarDays, Lightbulb, User, CircleSlash, Gauge } from "../../shared/icons";

// LINK AN ITEM (the reminders rebuild push C, 2026-09-15, brief section 4).
// A reminder can be about one record: a task, a note, an event, a decision
// a contact, or a health log (push D). The link is one way (deleting the
// reminder never touches the record) and gives the reminder its primary
// action. This is the picker: a sheet over the reminder sheet, one search
// field over every kind, rows grouped by kind, and No Link to clear. Emails
// can be linked by the surface that owns them; they are not offered here.

export interface LinkCandidate { type: LinkedType; id: string; label: string }

const GLYPH: Record<string, React.ReactNode> = {
  task: <ListChecks className="ic" />,
  note: <FileText className="ic" />,
  event: <CalendarDays className="ic" />,
  decision: <Lightbulb className="ic" />,
  contact: <User className="ic" />,
  healthItem: <Gauge className="ic" />,
};
const PLURAL: Record<string, string> = { task: "Tasks", event: "Events", note: "Notes", decision: "Decisions", contact: "Contacts", healthItem: "Health", email: "Emails" };
const TONE: Record<string, string> = { task: "red", note: "orange", event: "sky", decision: "purple", contact: "pink", healthItem: "green" };
const ORDER: LinkedType[] = ["task", "event", "note", "decision", "contact", "healthItem"];

export default function LinkedItemSheet({ candidates, current, onPick, onCancel }: {
  candidates: LinkCandidate[];
  current: LinkedItem | null;
  onPick: (link: LinkedItem | null) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const hit = (s: string) => !query || s.toLowerCase().includes(query);
  const groups = ORDER.map((type) => ({ type, rows: candidates.filter((c) => c.type === type && hit(c.label)).slice(0, 40) })).filter((g) => g.rows.length > 0);
  const empty = candidates.length === 0;
  const pick = (c: LinkCandidate) => { onPick({ type: c.type, id: c.id, label: c.label }); };
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card link-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grp"><div className="eyebrow">Linked Item</div></div>
        {!empty && (
          <div className="sub-bar">
            <div className="search-bar">
              <Search className="ic" />
              <input placeholder="Search" aria-label="Search items to link" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        )}
        {empty && <div className="input-help">Nothing to link yet. Tasks, events, notes, decisions and contacts show up here.</div>}
        {!empty && groups.length === 0 && <div className="input-help">Nothing here matches that.</div>}
        <div className="link-sheet-list">
          {current && (
            <div className="row" {...pressable(() => onPick(null))}>
              <div className="proj-icon cat-bg-graphite"><CircleSlash className="ic" /></div>
              <div className="conn-name">No Link</div>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.type}>
              <div className="eyebrow link-sheet-kind">{PLURAL[g.type] ?? linkedTypeWord(g.type)}</div>
              {g.rows.map((c) => (
                <div key={c.type + c.id} className={"row" + (current?.id === c.id && current.type === c.type ? " on" : "")} {...pressable(() => pick(c))} aria-pressed={current?.id === c.id && current.type === c.type}>
                  <div className={"proj-icon cat-bg-" + (TONE[c.type] ?? "graphite")}>{GLYPH[c.type]}</div>
                  <div className="conn-name">{c.label}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="action-sheet">
          <button className="cancel" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
