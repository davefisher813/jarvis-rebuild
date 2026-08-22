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
  { key: "blank", name: "Blank", desc: "An empty page.", cat: "blue", Icon: AlignLeft },
  { key: "meeting", name: "Meeting Notes", desc: "Date, attendees, agenda, decisions, action items.", cat: "sky", Icon: CalendarDays },
  { key: "todo", name: "To-Do / Checklist", desc: "A checklist · Turns into tasks.", cat: "green", Icon: ListTodo },
  { key: "tracker", name: "Tracker", desc: "A table you define: rows, columns, sums.", cat: "yellow", Icon: Table },
  { key: "brief", name: "Project Brief", desc: "Objective, key dates, tasks, notes.", cat: "red", Icon: FileText },
  { key: "journal", name: "Log / Journal", desc: "Date-stamped entries over time.", cat: "teal", Icon: ListOrdered },
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

      {/* V4: templates are a content list, the Library form. Bare colored
          glyphs, flat rows, one mini-caps label. */}
      <div className="sh2 sh2-caps"><span className="t">Templates</span></div>
      {TEMPLATES_LIST.map(({ key, name, desc, cat, Icon }) => (
        <div className="lib-row" key={key} role="button" tabIndex={0} onClick={() => onSelect?.(key)}>
          <div className={"lib-ico cat-fg-" + cat}>
            <Icon className="ic" />
          </div>
          <div className="lib-stack">
            <div className="lib-name">{name}</div>
            <div className="lib-sub">{desc}</div>
          </div>
          <div className="chev"></div>
        </div>
      ))}
    </div>
  );
}
