import { useEffect, useRef, useState } from "react";
import { AlignLeft, CalendarDays, ListTodo, Table, FileText, ListOrdered, Target, User, Send } from "../../shared/icons";
import type { TemplateKey } from "../types";
import type { PageKind } from "../pages/pageModel";
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

// TEMPLATE PAGES (issue #115): a note with structure. Records with stable
// ids, fields he can rename, export to Sheets and back.
const PAGES_LIST: { key: PageKind; name: string; desc: string; cat: string; Icon: typeof AlignLeft }[] = [
  { key: "scorecard", name: "Golf Scorecard", desc: "Holes, Players, Running Totals", cat: "green", Icon: Target },
  { key: "team", name: "Team Sheet", desc: "A Roster: Name, Number, Position", cat: "blue", Icon: User },
  { key: "lineup", name: "Lineup Card", desc: "An Order Picked from a Team Sheet", cat: "purple", Icon: ListOrdered },
  { key: "outreach", name: "Outreach Tracker", desc: "Who, How, Status, Next Step", cat: "orange", Icon: Send },
];

export default function Templates({
  onSelect,
  onPage,
  onBack,
}: {
  onSelect?: (key: TemplateKey) => unknown;
  onPage?: (key: PageKind) => unknown;
  onBack?: () => void;
}) {
  // #106 V3 (Dave, with #115): a template tap answers the instant it lands.
  // The row takes its pressed state and a spinner while the note is made and
  // the editor loads, and every other tap waits for it, so a second tap on a
  // slow phone can never make a second note.
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const tap = (key: string, run: () => unknown) => {
    if (busyRef.current) return;
    busyRef.current = key;
    setBusy(key);
    void Promise.resolve().then(run).finally(() => {
      busyRef.current = null;
      if (alive.current) setBusy(null);
    });
  };
  const row = (key: string, name: string, desc: string, cat: string, Icon: typeof AlignLeft, run: () => unknown) => (
    <div className="lib-row" key={key} aria-busy={busy === key || undefined} aria-disabled={(busy !== null && busy !== key) || undefined}
      {...pressable(() => tap(key, run))}>
      <div className={"lib-ico cat-fg-" + cat}>
        <Icon className="ic" />
      </div>
      <div className="lib-stack">
        <div className="lib-name">{name}</div>
        <div className="lib-sub">{desc}</div>
      </div>
      {busy === key ? <span className="spinner" role="status" aria-label={"Opening " + name} /> : <div className="chev"></div>}
    </div>
  );
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
      {TEMPLATES_LIST.map(({ key, name, desc, cat, Icon }) => row(key, name, desc, cat, Icon, () => onSelect?.(key)))}
      {onPage && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Template Pages</span></div>
          {PAGES_LIST.map(({ key, name, desc, cat, Icon }) => row("page-" + key, name, desc, cat, Icon, () => onPage(key)))}
        </>
      )}
    </div>
  );
}
