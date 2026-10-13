import { AlignLeft, CalendarDays, ListTodo, Table, FileText, ListOrdered } from "../../shared/icons";
import type { TemplateKey } from "../types";
import { pressable } from "../../shared/pressable";

// Matches locked frame #49 "Templates" (the New Note picker). Keys match the
// TEMPLATES map in types.ts so a tap seeds the right blocks.
const TEMPLATES_LIST: {
  key: TemplateKey;
  name: string;
  desc: string;
  cat: string;
  Icon: typeof AlignLeft;
}[] = [
  { key: "blank", name: "Blank", desc: "An Empty Page", cat: "blue", Icon: AlignLeft },
  { key: "meeting", name: "Meeting Notes", desc: "Date, Attendees, Agenda, Decisions, Action Items", cat: "sky", Icon: CalendarDays },
  { key: "todo", name: "To-Do / Checklist", desc: "A Checklist That Turns Into Tasks", cat: "green", Icon: ListTodo },
  { key: "tracker", name: "Tracker", desc: "A Table You Define: Rows, Columns, Sums", cat: "yellow", Icon: Table },
  { key: "brief", name: "Project Brief", desc: "Objective, Key Dates, Tasks, Notes", cat: "red", Icon: FileText },
  { key: "journal", name: "Log / Journal", desc: "Date-Stamped Entries Over Time", cat: "teal", Icon: ListOrdered },
];

export default function Templates({
  onSelect,
  onBack,
  pending = null,
}: {
  onSelect?: (key: TemplateKey) => void;
  onBack?: () => void;
  // The template whose note is being made and opened (issue 106, V3). While
  // one is, its row is the pressed one and carries the ring in place of the
  // chevron, and every row stands down: a second tap would make a second note.
  pending?: TemplateKey | null;
}) {
  const locked = pending != null;
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
      <div className="sh2 sh2-quiet"><span className="t">Templates</span></div>
      {TEMPLATES_LIST.map(({ key, name, desc, cat, Icon }) => {
        const busy = pending === key;
        return (
          // Busy and unavailable are said in ARIA and drawn from it (components.css,
          // .lib-row[aria-busy]), so the look cannot drift from what a screen reader hears.
          // The back link above stays live: a person who changed their mind is never trapped.
          <div className="lib-row" key={key}
            aria-busy={busy || undefined}
            aria-disabled={locked && !busy ? true : undefined}
            {...pressable(() => onSelect?.(key), { disabled: locked })}>
            <div className={"lib-ico cat-fg-" + cat}>
              <Icon className="ic" />
            </div>
            <div className="lib-stack">
              <div className="lib-name">{name}</div>
              <div className="lib-sub">{desc}</div>
            </div>
            {busy ? <span className="spinner" role="status" aria-label="Opening" /> : <div className="chev"></div>}
          </div>
        );
      })}
    </div>
  );
}
