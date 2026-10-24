import { useEffect, useRef, useState } from "react";
import { AlignLeft, CalendarDays, ListTodo, Table, FileText, ListOrdered, Target, User, Send, ListChecks, Dumbbell, Wallet, DollarSign, Home, Gauge, Timer, Flame, Lightbulb, Clock, Mail, Brain, FolderKanban, Zap, Sparkles, PersonStanding, Tag } from "../../shared/icons";
import type { TemplateKey } from "../types";
import type { PageKind } from "../pages/pageModel";
import { TEMPLATES, TEMPLATE_KEYS, SHELVES, type IconKey, type Shelf } from "../pages/templateDefs";
import { pressable } from "../../shared/pressable";
import RowActionSheet from "../../shared/RowActionSheet";
import BackPill from "../../shared/BackPill";

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

// TEMPLATE PAGES (issue #115): a note with structure. Records with stable ids, fields he can rename, export to Sheets and back.
// They sit on shelves (Sports, Life, Finance, Professional, Entertainment). The four of slice 1 keep their own screens; every
// template after them is a definition in pages/templateDefs.ts, listed here from it.
const ICONS: Record<IconKey, typeof AlignLeft> = {
  target: Target, user: User, list: ListOrdered, send: Send, table: Table, checks: ListChecks, dumbbell: Dumbbell, calendar: CalendarDays, file: FileText, wallet: Wallet,
  dollar: DollarSign, home: Home, gauge: Gauge, timer: Timer, flame: Flame, bulb: Lightbulb, clock: Clock, mail: Mail, brain: Brain, kanban: FolderKanban, zap: Zap,
  sparkles: Sparkles, person: PersonStanding, tag: Tag,
};

interface PageEntry { key: string; name: string; desc: string; cat: string; Icon: typeof AlignLeft; shelf: Shelf }

const CORE: PageEntry[] = [
  { key: "scorecard", name: "Golf Scorecard", desc: "Holes, Players, Running Totals", cat: "green", Icon: Target, shelf: "Sports" },
  { key: "team", name: "Team Sheet", desc: "A Roster, Lineups, Fees and Dates", cat: "blue", Icon: User, shelf: "Sports" },
  { key: "outreach", name: "Outreach Tracker", desc: "Who, How, Status, Next Step", cat: "orange", Icon: Send, shelf: "Sports" },
];

// A preset or entry point (Home Inventory under Home and Vehicle Book, Meal Plan under Kitchen Page) is not a row of its own: its parent's row
// asks which one. So the picker lists the templates the library names, and each preset stays one tap further in. A template that
// belongs on two shelves (`alsoShelves`: Accomplishments and Milestones under Life and Professional) is one template drawn under
// each, the same key and the same page; the count of templates does not move.
const PAGES_LIST: PageEntry[] = [
  ...CORE,
  ...TEMPLATE_KEYS.filter((k) => !TEMPLATES[k].parent && !TEMPLATES[k].retired).flatMap((k) =>
    [TEMPLATES[k].shelf, ...(TEMPLATES[k].alsoShelves ?? [])].map((shelf) =>
      ({ key: k, name: TEMPLATES[k].shelfName ?? TEMPLATES[k].name, desc: TEMPLATES[k].desc, cat: TEMPLATES[k].cat, Icon: ICONS[TEMPLATES[k].icon], shelf }))),
];

/** The entry points a template offers: itself first, then every preset under it. Empty when it has none. */
export const entriesOf = (key: string): { key: string; label: string }[] => {
  const kids = TEMPLATE_KEYS.filter((k) => TEMPLATES[k].parent === key);
  if (!kids.length) return [];
  const own = TEMPLATES[key as keyof typeof TEMPLATES];
  // The Golf Scorecard is a core page, not a catalog template, so its own entry is named here: a new round, then its history.
  return [{ key, label: own?.entry ?? own?.name ?? (key === "scorecard" ? "New Round" : key) }, ...kids.map((k) => ({ key: k as string, label: TEMPLATES[k].entry ?? TEMPLATES[k].name }))];
};

/** A template the person kept from a page of their own (Save as My Template). */
export interface MyTemplate { id: string; title: string; kindName: string }

export default function Templates({
  onSelect,
  onPage,
  mine = [],
  onBack,
  pending = null,
}: {
  onSelect?: (key: TemplateKey) => unknown;
  onPage?: (key: PageKind | string) => unknown;
  /** The person's own templates, started from the picker with their structure and none of their rows. */
  mine?: MyTemplate[];
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
  const [choosing, setChoosing] = useState<string | null>(null);
  const go = (key: string) => {
    setPageBusy(key);
    void Promise.resolve(onPage?.(key)).finally(() => { if (alive.current) setPageBusy(null); });
  };
  const pageRow = (key: string, name: string, desc: string, cat: string, Icon: typeof AlignLeft) => {
    const busy = pageBusy === key || (choosing === null && pageBusy !== null && entriesOf(key).some((e) => e.key === pageBusy));
    return (
      <div className="lib-row" key={"page-" + key}
        aria-busy={busy || undefined}
        aria-disabled={anyBusy && !busy ? true : undefined}
        {...pressable(() => { if (entriesOf(key).length) setChoosing(key); else go(key); }, { disabled: anyBusy })}>
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
  };
  return (
    <div className="screen">
      <div className="nav-bar">
        <BackPill label="Notes" onClick={() => onBack?.()} />
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
      {onPage && SHELVES.map((shelf) => {
        const rows = PAGES_LIST.filter((p) => p.shelf === shelf);
        if (!rows.length) return null;
        return (
          <div key={shelf}>
            <div className="sh2 sh2-quiet"><span className="t">{shelf}</span></div>
            {rows.map(({ key, name, desc, cat, Icon }) => pageRow(key, name, desc, cat, Icon))}
          </div>
        );
      })}
      {choosing && (
        <RowActionSheet title={(PAGES_LIST.find((p) => p.key === choosing)?.name ?? "Which One") + ": Which One?"} onCancel={() => setChoosing(null)}
          actions={entriesOf(choosing).map((e) => ({ label: e.label, onPick: () => { setChoosing(null); go(e.key); } }))} />
      )}
      {onPage && mine.length > 0 && (
        <div>
          <div className="sh2 sh2-quiet"><span className="t">My Templates</span></div>
          {mine.map((m) => pageRow("mine:" + m.id, m.title, m.kindName, "graphite", FileText))}
        </div>
      )}
    </div>
  );
}
