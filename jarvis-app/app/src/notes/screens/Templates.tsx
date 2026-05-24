import { AlignLeft, CalendarDays, ListTodo, Table, FileText, ListOrdered } from "lucide-react";
import type { TemplateKey } from "../types";

// Matches locked frame #49 "Templates" (the New Note picker). Keys match the
// TEMPLATES map in types.ts so a tap seeds the right blocks.
const TEMPLATES_LIST: {
  key: TemplateKey;
  name: string;
  desc: string;
  cat: string;
  Icon: typeof AlignLeft;
}[] = [
  { key: "blank", name: "Blank", desc: "Start with an empty page.", cat: "brain", Icon: AlignLeft },
  { key: "meeting", name: "Meeting Notes", desc: "Date, attendees, agenda, decisions, action items.", cat: "tucci", Icon: CalendarDays },
  { key: "todo", name: "To-Do / Checklist", desc: "A simple checklist you can turn into tasks.", cat: "health", Icon: ListTodo },
  { key: "tracker", name: "Tracker", desc: "A table you define: rows, columns, sums.", cat: "money", Icon: Table },
  { key: "brief", name: "Project Brief", desc: "Objective, key dates, tasks, notes.", cat: "elite", Icon: FileText },
  { key: "journal", name: "Log / Journal", desc: "Date-stamped entries over time.", cat: "friends", Icon: ListOrdered },
];

export default function Templates({
  onSelect,
  onBack,
}: {
  onSelect?: (key: TemplateKey) => void;
  onBack?: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" onClick={onBack}>Notes</button>
        <span className="nav-title"></span>
        <span></span>
      </div>
      <div className="nav-large">New Note</div>

      <div className="grp">
        <div className="eyebrow">Templates</div>
      </div>

      <div className="pad-x">
        <div className="card">
          {TEMPLATES_LIST.map(({ key, name, desc, cat, Icon }) => (
            <div className="row" key={key} onClick={() => onSelect?.(key)}>
              <div className={"proj-icon cat-bg-" + cat}>
                <Icon className="ic" />
              </div>
              <div className="row-stack">
                <div className="conn-name">{name}</div>
                <div className="t-meta">{desc}</div>
              </div>
              <div className="chev"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
