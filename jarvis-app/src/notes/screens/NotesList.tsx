import { Fragment, useState } from "react";
import PageHeader, { BarAction, BarText } from "../../shared/PageHeader";
import { Check, FileText, PenLine, Search } from "../../shared/icons";
import { useSelection } from "../../shared/useSelection";
import SelectBar from "../../shared/SelectBar";
import { catColor, catName } from "../../shared/categories";
import { ParentLineGlyph } from "../../shared/glyphs";
import { todayISO } from "../../tasks/grouping";
import { monthDay } from "../../money/bills";

// NOTES, PORTED (Notes and Money catalog, 2026-09-02). The library rows of
// locked frame #46 (2026-08-18) are gone from this page; the note is a row
// in the same card every task list wears, its second line the one every
// task row already uses. The real iOS chrome (status bar, home indicator)
// is drawn by the device; this uses the canonical .screen container.

export interface NoteListItem {
  id: string;
  title: string;
  edited: number; // epoch ms of the last write; 0 when the store cannot say
  category: string; // drives the area dot's colour
  first: string; // the body's first line, as words; "" for a title-only note
}

// THE ROW AND THE GROUPING are the catalog's first two picks; the constants
// are the switches. Row: "line" is the area dot and name with the edit date
// on the kicker line (recommended); "glyph" is one line with the page glyph
// in the area's colour; "first" is that glyph and the note's own first line
// in grey. Grouping: "when" is Today / Yesterday / Earlier (recommended);
// "area" is Tasks' Group by, one card per area; "flat" is one card, newest
// first.
const NOTES_ROW = "line" as "line" | "glyph" | "first";
const NOTES_GROUP = "when" as "when" | "area" | "flat";

const DAY = 24 * 60 * 60 * 1000;

// Which day a note was last touched, against the calendar, not the clock:
// a note edited at 11pm is "yesterday" at 1am, not "today" for two hours.
function dayDiff(edited: number, now: Date): number {
  const then = new Date(edited);
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  return Math.round((a - b) / DAY);
}

// "Edited today" / "Yesterday" / "Aug 30" / "Aug 30, 2025". The one word
// "Edited" rides only the freshest case: on a dated row the date is the
// edit, and saying so on every line was the noise the catalog removed.
export function editedLabel(edited: number, now: Date = new Date()): string {
  if (!edited) return "";
  const d = dayDiff(edited, now);
  if (d <= 0) return "Edited today";
  if (d === 1) return "Yesterday";
  const then = new Date(edited);
  const md = monthDay(todayISO(then));
  return then.getFullYear() === now.getFullYear() ? md : `${md}, ${then.getFullYear()}`;
}

// Notes is a tab-level surface: there is deliberately no back button on the
// list (audit 2026-08-10 removed a dead onBack prop no parent ever passed).
export default function NotesList({
  notes,
  onOpen,
  onNewNote,
  onDeleteMany,
}: {
  notes: NoteListItem[];
  onOpen?: (id: string) => void;
  onNewNote?: () => void;
  onDeleteMany?: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const now = new Date();
  // Newest first, always (Apple Notes' own order). A note the store cannot
  // date keeps the order the store gave it, behind every dated one.
  const ordered = [...notes].sort((a, b) => b.edited - a.edited);
  const shown = query ? ordered.filter((n) => n.title.toLowerCase().includes(query)) : ordered;
  // The SEARCHED list, not the whole one. Select All while a search is
  // narrowing the page must mean the notes on screen: deleting the ones
  // hidden behind a query would be the worst possible version of this.
  const sel = useSelection(shown.map((n) => n.id));

  // The groups. Under "when" the heads are the day the note was touched;
  // notes the store cannot date fall into Earlier. Under "area" every note
  // sits under its area, unfiled ones last under their own yellow head.
  type Group = { key: string; head: string; color: string | null; items: NoteListItem[] };
  const groups: Group[] = [];
  const put = (key: string, head: string, color: string | null, n: NoteListItem) => {
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, head, color, items: [] }; groups.push(g); }
    g.items.push(n);
  };
  if (NOTES_GROUP === "when") {
    for (const n of shown) {
      const d = n.edited ? dayDiff(n.edited, now) : 99;
      if (d <= 0) put("today", "Today", null, n);
      else if (d === 1) put("yesterday", "Yesterday", null, n);
      else put("earlier", "Earlier", null, n);
    }
  } else if (NOTES_GROUP === "area") {
    for (const n of shown) {
      const name = n.category ? catName(n.category) : "";
      if (name) put(n.category, name, catColor(n.category), n);
      else put("", "Not Filed", "yellow", n);
    }
    const idx = groups.findIndex((g) => g.key === "");
    if (idx >= 0) groups.push(groups.splice(idx, 1)[0]!);
  } else {
    for (const n of shown) put("all", "All Notes", null, n);
  }

  const row = (n: NoteListItem) => {
    const picked = sel.isSelected(n.id);
    // An unfiled note wears yellow (Dave 2026-08-29: "default should be
    // yellow"), a legal-pad colour that says "a note", deliberately not any
    // category's claim. A filed note keeps its category's own colour, which
    // is what makes the yellow readable as "not filed yet".
    const tone = "cat-fg-" + (n.category ? catColor(n.category) : "yellow");
    const area = n.category ? catName(n.category) : "";
    const when = editedLabel(n.edited, now);
    return (
      <div
        className="task-row p2 note-row"
        role="button" tabIndex={0} key={n.id}
        onClick={() => (sel.active ? sel.toggle(n.id) : onOpen?.(n.id))}
      >
        {/* The selection box takes the leading column: on a row with a glyph
            it is the glyph's column, on the line row it is the check column
            every task row keeps for exactly this. */}
        {sel.active ? (
          <div className="task-check-tap">
            <button
              type="button"
              className={"sel-box" + (picked ? " on" : "")}
              role="checkbox" aria-checked={picked}
              aria-label={(picked ? "Deselect " : "Select ") + n.title}
              onClick={(e) => { e.stopPropagation(); sel.toggle(n.id); }}
            >{picked && <Check className="ic" />}</button>
          </div>
        ) : NOTES_ROW !== "line" ? (
          <div className="task-check-tap"><span className={"gm-slot " + tone}><FileText className="ic" /></span></div>
        ) : null}
        <div className="task-title">
          <span className="task-name">{n.title}</span>
          {NOTES_ROW === "line" && (
            <div className="r-k">
              <ParentLineGlyph p={{ kind: "category", name: area || "Not Filed", tone, pct: null }} />
              {when && <span className="r-goal r-cat r-when">{"· " + when}</span>}
            </div>
          )}
          {NOTES_ROW === "first" && n.first && <div className="note-first">{n.first}</div>}
        </div>
        {!sel.active && <div className="chev"></div>}
      </div>
    );
  };

  return (
    <div className="screen ruled">
      {/* Library chassis (Design 2, approved 2026-08-18): pencil rides the
          bar, search under the title. */}
      <PageHeader
        title="Notes"
        actions={
          sel.active ? (
            <BarText label="Done" strong onClick={sel.exit} />
          ) : (
            <>
              {onDeleteMany && shown.length > 0 && <BarText label="Select" onClick={() => sel.enter()} />}
              <BarAction label="New Note" onClick={onNewNote}><PenLine className="ic" /></BarAction>
            </>
          )
        }
      >
        <div className="sub-bar">
          <div className="search-bar">
            <Search className="ic" />
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </PageHeader>

      {/* RED IS A VERB (Dave 2026-08-30, chapter three, history on LAW 11):
          this head spent one deploy in accent as "Notes' one red head"; his
          phone verdict made Today the reference, and Today's heads are quiet.
          A library index is information, not a verb. Under "area" the head
          is Tasks' own group head, the dot in the area's colour. */}
      {groups.map((g) => (
        <Fragment key={g.key}>
          {g.color ? (
            <div className="grp-head"><span className={"cat-dot cat-bg-" + g.color} />{g.head}<span className="n">{g.items.length}</span></div>
          ) : (
            <div className="sh2 sh2-quiet"><span className="t">{g.head}</span><span className="n">{g.items.length}</span></div>
          )}
          <div className="pad-x"><div className="card list-card-ruled">{g.items.map(row)}</div></div>
        </Fragment>
      ))}
      {query && shown.length === 0 && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="task-row p2"><div className="task-title"><span className="task-name">No notes match &ldquo;{q.trim()}&rdquo;</span></div></div>
        </div></div>
      )}
      {onDeleteMany && (
        <SelectBar sel={sel} noun="Note" onDelete={() => { onDeleteMany(sel.selected); sel.exit(); }} />
      )}
      <div className="screen-foot" />
    </div>
  );
}
