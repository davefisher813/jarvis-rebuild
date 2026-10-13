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
  pending = null,
}: {
  onSelect?: (key: TemplateKey) => unknown;
  onPage?: (key: PageKind) => unknown;
  onBack?: () => void;
  // The template whose note is being made and opened (issue 106, V3). While
  // one is, its row is the pressed one and carries the ring in place of the
  // chevron, and every row stands down: a second tap would make a second note.
  pending?: TemplateKey | null;
}) {
  const locked = pending != null;
  // Template pages (#115) answer the same way: the tapped row is pressed and ringed at once, and every row stands
  // down until the page is made (the flow's creatingRef is the guard against a second page).
  const [pageBusy, setPageBusy] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const anyBusy = locked || pageBusy !== null;
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
            aria-disabled={anyBusy && !busy ? true : undefined}
            {...pressable(() => onSelect?.(key), { disabled: anyBusy })}>
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
      {onPage && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Template Pages</span></div>
          {PAGES_LIST.map(({ key, name, desc, cat, Icon }) => {
            const busy = pageBusy === key;
            return (
              <div className="lib-row" key={"page-" + key}
                aria-busy={busy || undefined}
                aria-disabled={anyBusy && !busy ? true : undefined}
                {...pressable(() => {
                  setPageBusy(key);
                  void Promise.resolve(onPage(key)).finally(() => { if (alive.current) setPageBusy(null); });
                }, { disabled: anyBusy })}>
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
        </>
      )}
    </div>
  );
}
