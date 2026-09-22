import { Fragment, useState, type ReactNode, useEffect } from "react";
import PageHeader, { BarAction, BarText } from "../../shared/PageHeader";
import LifeHeader, { OptionsButton, type HeaderView } from "../../shared/LifeHeader";
import HeadMenu from "../../shared/HeadMenu";
import OptionsSheet, { type OptionRow } from "../../shared/OptionsSheet";
import { Check, FileText, Paperclip, PenLine, Search, Tag, Trash2, Plus } from "../../shared/icons";
import { useSwipe, type SwipeState } from "../../shared/useSwipe";
import { useSelection } from "../../shared/useSelection";
import SelectBar from "../../shared/SelectBar";
import { catColor, catName } from "../../shared/categories";
import { ParentLineGlyph } from "../../shared/glyphs";
import { todayISO } from "../../tasks/grouping";
import { monthDay } from "../../money/bills";
import { pressable } from "../../shared/pressable";
import EntityStar from "../../shared/EntityStar";

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
  // S6-Q37 (2026-09-04): "in-page search ignores note bodies." Built via
  // search.ts's noteBlockText (the same haystack global search matches
  // against), never rendered -- search-only, so a note with a match buried
  // deep in a checklist is still one keystroke away here, same as it
  // already is from the search sheet.
  body: string;
  // C-18 (Astra, 2026-09-12)
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
  // C-20: candidates JARVIS found and he has not used yet.
  found?: number;
  // Wave 3b: in Recently Deleted.
  deleted?: boolean;
}

// C-18: the filter chips. Choosers, so filled chips.
/** THE AREA IS ITS OWN AXIS NOW (Dave 2026-09-17: "Don't forget to add it to
 *  notes page as well" -- the pinned Area menu Tasks got).
 *
 *  It used to be a member of this union, which made it a VIEW: picking
 *  Personal deselected All, Pinned and Unfiled, because a note could only be
 *  in one of them at a time. That is not what an area is. On Tasks the view
 *  and the area have always been two independent cuts that compose -- Today
 *  AND Personal -- and this page now reads the same way, which is the whole
 *  point of one header on five pages. */
type Filter = { kind: "all" } | { kind: "pinned" } | { kind: "unfiled" } | { kind: "tag"; tag: string } | { kind: "archived" } | { kind: "deleted" };
/** The three the handoff names, in its order, plus the two destinations that
 *  used to live in the options sheet. "Unfiled" is the mockup's word for what
 *  this page called "Not Filed"; the filter itself is the same `unfiled` it
 *  always was.
 *
 *  Archived and Recently Deleted joined them on 2026-09-18, when the views
 *  became a menu: they were always views of this library, and the only
 *  reason they sat in the sheet was that a chip row had no room for five.
 *  They still appear only when they hold something, because a view of
 *  nothing is furniture. */
const VIEWS: HeaderView[] = [
  { key: "all", label: "All" },
  { key: "pinned", label: "Pinned" },
  { key: "unfiled", label: "Unfiled" },
];
const sameFilter = (a: Filter, b: Filter) => JSON.stringify(a) === JSON.stringify(b);

// THE SWIPE ON A NOTE (Dave 2026-09-02:

// THE SWIPE ON A NOTE (Dave 2026-09-02: "Notes should be able to swipe and
// take action (delete and whatever else you think is appropriate)"). The
// task row's own shell: two slots slide in from the right, File (the area
// picker, since every note on the list said Not Filed) and Delete (with
// Undo, the flow's own). Off in select mode, where a half-swiped row under
// a selection is two gestures fighting.
type RowDrag = { dragging: boolean; style?: React.CSSProperties; handlers?: SwipeState["handlers"] };
function NoteSwipeRow({ enabled, label, onFile, onAppend, onDelete, forever = false, children }: {
  /** The note's own name, so the rail says WHICH note it would delete. */
  enabled: boolean; label: string; onFile?: () => void; onAppend?: () => void; onDelete?: () => void; forever?: boolean; children: (drag: RowDrag) => ReactNode;
}) {
  const swipe = useSwipe({ revealW: 88 * (1 + (onFile ? 1 : 0) + (onAppend ? 1 : 0)), enabled });
  return (
    <div className="task-swipe">
      {/* QUICK APPEND (the writing system, wave 3): a line onto a note
          without opening it, from the same swipe File and Delete live on. */}
      {onAppend && (
        <button className="task-snooze note-append" onClick={() => swipe.closeThen(onAppend)} aria-label="Add to this note">
          <Plus className="ic" />
          <span className="swipe-label">Add</span>
        </button>
      )}
      {onFile && (
        <button className="task-snooze" onClick={() => swipe.closeThen(onFile)} aria-label="File under an area">
          <Tag className="ic" />
          <span className="swipe-label">File</span>
        </button>
      )}
      <button className="task-del" onClick={() => swipe.closeThen(onDelete)} aria-label={(forever ? "Delete forever: " : "Delete ") + label}>
        <Trash2 className="ic" />
        <span className="swipe-label">{forever ? "Forever" : "Delete"}</span>
      </button>
      {children({ dragging: swipe.dragging, style: swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined, handlers: swipe.handlers })}
    </div>
  );
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
  onAddFile,
  uploading = false,
  onDeleteMany,
  onFile,
  onAppend,
  onRestore,
  onDeleteForever,
  onDelete,
}: {
  notes: NoteListItem[];
  onOpen?: (id: string) => void;
  onNewNote?: () => void;
  // THE CLIP (Dave 2026-09-02: "both pages need to have a pic/file upload
  // button"): a photo or file becomes a new note, titled after it, opened.
  onAddFile?: () => void;
  uploading?: boolean;
  onDeleteMany?: (ids: string[]) => void;
  // The swipe's two moves (2026-09-02): file under an area, delete one.
  onFile?: (id: string) => void;
  onAppend?: (id: string) => void;
  onRestore?: (id: string) => void;
  onDeleteForever?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const now = new Date();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [optsOpen, setOptsOpen] = useState(false);
  /** Which sub-list the options sheet is showing: the areas, or the tags.
   *  Null is the sheet's own list of rows. */
  /** The area cut, composing with whichever view is chosen. Null is every
   *  area, which is what the menu calls All Areas. */
  const [area, setArea] = useState<string | null>(null);
  // Newest first, always (Apple Notes' own order). A note the store cannot
  // date keeps the order the store gave it, behind every dated one.
  const ordered = [...notes].sort((a, b) => b.edited - a.edited);
  // C-18: archived notes leave every list except the Archived filter and
  // search; the other chips narrow the live notes.
  // Recently Deleted is its own room: nothing there shows anywhere else,
  // and search does not reach it.
  const kept = ordered.filter((n) => !n.deleted);
  const deletedCount = ordered.length - kept.length;
  const live = kept.filter((n) => !n.archived);
  const areaIds = [...new Set(live.map((n) => n.category).filter(Boolean))];
  const tagNames = [...new Set(live.flatMap((n) => n.tags ?? []))].sort();
  const unfiledCount = live.filter((n) => !n.category).length;
  const archivedCount = kept.length - live.length;
  useEffect(() => {
    if ((filter.kind === "deleted" && deletedCount === 0) || (filter.kind === "archived" && archivedCount === 0)) setFilter({ kind: "all" });
  }, [filter.kind, deletedCount, archivedCount]);
  const inView = filter.kind === "deleted" ? ordered.filter((n) => !!n.deleted)
    : filter.kind === "archived" ? kept.filter((n) => !!n.archived)
    : filter.kind === "pinned" ? live.filter((n) => !!n.pinned)
    : filter.kind === "unfiled" ? live.filter((n) => !n.category)
    : filter.kind === "tag" ? live.filter((n) => (n.tags ?? []).includes(filter.tag))
    : live;
  // The two cuts compose, in the order they are chosen: the view says which
  // notes are in play, the area says which of those are this one's.
  const filtered = area ? inView.filter((n) => n.category === area) : inView;
  // S6-Q37: title OR body, same two-part rule search.ts's noteHas uses.
  // Search reaches the archive too.
  const searched = query ? kept.filter((n) => n.title.toLowerCase().includes(query) || n.body.toLowerCase().includes(query)) : filtered;
  // A search is still cut by the area, which is what the scope line says.
  const shown = query && area ? searched.filter((n) => n.category === area) : searched;
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
      // C-18: pinned notes lead, under their own head.
      if (n.pinned && !n.archived && filter.kind !== "archived") { put("pinned", "Pinned", null, n); continue; }
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
    const body = (drag: RowDrag) => (
      <div
        className={"task-row p2 note-row" + (drag.dragging ? " swiping" : "")}
        {...pressable(() => (sel.active ? sel.toggle(n.id) : n.deleted ? onRestore?.(n.id) : onOpen?.(n.id)))}
        style={drag.style}
        {...(drag.handlers ?? {})}>
        {/* The selection box takes the leading column: on a row with a glyph
            it is the glyph's column, on the line row it is the check column
            every task row keeps for exactly this. */}
        {/* C-50: the Remember star leads the row. */}
        {!sel.active && <EntityStar entityType="note" entityId={n.id} title={n.title} />}
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
              {(n.tags ?? []).map((t) => <span className="r-goal r-cat" key={t}>{"· #" + t}</span>)}
              {(n.found ?? 0) > 0 && <span className="r-goal r-cat fact purp">{"· JARVIS found " + n.found}</span>}
              {when && <span className="r-goal r-cat r-when">{"· " + when}</span>}
            </div>
          )}
          {NOTES_ROW === "first" && n.first && <div className="note-first">{n.first}</div>}
        </div>
        {!sel.active && n.deleted && onRestore && <span className="pill-act">Restore</span>}
        {!sel.active && !n.deleted && <div className="chev"></div>}
      </div>
    );
    // A deleted row's swipe is Delete Forever alone; the other doors are
    // for a note that is still here.
    if (n.deleted) {
      return onDeleteForever ? (
        <NoteSwipeRow key={n.id} enabled={!sel.active} label={n.title} onDelete={() => onDeleteForever(n.id)} forever>
          {body}
        </NoteSwipeRow>
      ) : <Fragment key={n.id}>{body({ dragging: false })}</Fragment>;
    }
    return onDelete ? (
      <NoteSwipeRow key={n.id} enabled={!sel.active} label={n.title} onFile={onFile ? () => onFile(n.id) : undefined} onAppend={onAppend ? () => onAppend(n.id) : undefined} onDelete={() => onDelete(n.id)}>
        {body}
      </NoteSwipeRow>
    ) : <Fragment key={n.id}>{body({ dragging: false })}</Fragment>;
  };

  return (
    <div className="screen ruled">
      {/* Library chassis (Design 2, approved 2026-08-18): pencil rides the
          bar, search under the title. */}
      <PageHeader
        title="Notes"
        actions={sel.active ? <BarText label="Done" strong onClick={sel.exit} /> : undefined}
        headActions={sel.active ? undefined : <OptionsButton onClick={() => setOptsOpen(true)} label="Notes Options" />}
      >
        {/* ONE HEADER, FIVE PAGES (Dave 2026-09-17, Unified Headers). Notes
            keeps its own page and its own place in the app -- the handoff is
            explicit that header consistency is "shared controls and spacing,
            not identical page contents" -- and takes the same search row,
            the same Add and the same chip row as the other four. */}
        <LifeHeader
          query={q}
          onQuery={setQ}
          placeholder="Search Notes"
          addLabel="New Note"
          onAdd={() => onNewNote?.()}
          views={[
            ...VIEWS,
            ...(archivedCount > 0 ? [{ key: "archived", label: "Archived", count: archivedCount }] : []),
            // Excluded from ordinary searches unless explicitly opened, which
            // is what choosing it here is.
            ...(deletedCount > 0 ? [{ key: "deleted", label: "Recently Deleted", short: "Deleted", count: deletedCount }] : []),
          ]}
          view={filter.kind === "tag" ? "all" : filter.kind}
          onView={(k) => setFilter({ kind: k } as Filter)}
          scope={q.trim() ? {
            count: shown.length,
            where: `${VIEWS.find((v) => v.key === filter.kind)?.label ?? "All"} notes${area ? ` in ${catName(area) || "this area"}` : ""}`,
            ...(filter.kind !== "all" || area ? { onAll: () => { setFilter({ kind: "all" }); setArea(null); }, allLabel: "Search all notes" } : {}),
          } : undefined}
          // AREA AND TAG, STACKED (Dave 2026-09-17: "Make multiple dropdown
          // chips like areas in the most logical way possible. Stack
          // dropdowns next to each other"). Both were chips in the wrapping
          // row this header replaced, then rows in the options sheet; they
          // are the two lists on this page that grow with the library, which
          // is exactly what a dropdown is for and a chip is not.
          drops={areaIds.length > 0 || tagNames.length > 0 ? (
            <>
              {areaIds.length > 0 && (
                <HeadMenu
                  ariaLabel="Area"
                  value={area ?? "all"}
                  label={area ? undefined : "Area"}
                  options={[{ value: "all", label: "All Areas" }, ...areaIds.map((id) => ({ value: id, label: catName(id) || "Area", dot: catColor(id) }))]}
                  // Unfiled means "has no area", so an area and that view can
                  // never both be true: choosing one moves off the other
                  // rather than leaving a list that is empty by construction.
                  onPick={(v) => { setArea(v === "all" ? null : v); if (v !== "all" && filter.kind === "unfiled") setFilter({ kind: "all" }); }}
                />
              )}
              {tagNames.length > 0 && (
                <HeadMenu
                  ariaLabel="Tag"
                  value={filter.kind === "tag" ? filter.tag : "all"}
                  label={filter.kind === "tag" ? undefined : "Tag"}
                  options={[{ value: "all", label: "All Tags" }, ...tagNames.map((t) => ({ value: t, label: "#" + t }))]}
                  onPick={(v) => setFilter(v === "all" ? { kind: "all" } : { kind: "tag", tag: v })}
                />
              )}
            </>
          ) : undefined}

        />
      </PageHeader>

      {/* THE CHIPS ARE WORKFLOW STATE AND NOTHING ELSE (handoff rule 2: "Do
          not mix area names, deleted records and workflow states in the same
          row"; and by name, "Notes: All, Pinned and Unfiled; Recently Deleted
          remains an options destination").
          
          What was here: those three, plus one chip per AREA with its dot,
          plus one per TAG, plus Archived, plus Recently Deleted -- a row that
          wrapped to three lines on a real library and mixed four different
          kinds of thing. Areas, tags, archived and deleted are all one tap
          away in the options sheet, which is where every page keeps them. */}

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
      {/* EVERYTHING THAT IS NOT A WORKFLOW STATE (handoff rule 7: "Notes-
          specific tools, including import and Recently Deleted, remain
          available"). Area and Tag each open their own list of answers in
          this same sheet rather than a second sheet on top of it. */}
      {optsOpen && (
        <OptionsSheet title="Notes Options" rows={([
          ...(onDeleteMany && shown.length > 0 ? [{
            key: "select", label: "Select Notes",
            onClick: () => { setOptsOpen(false); sel.enter(); },
          }] : []),
          ...(onAddFile ? [{
            key: "file", label: uploading ? "Uploading" : "Import or Attach",
            onClick: () => { setOptsOpen(false); if (!uploading) onAddFile(); },
          }] : []),
        ] as OptionRow[])} onClose={() => setOptsOpen(false)} />
      )}
      {onDeleteMany && (
        <SelectBar sel={sel} noun="Note" onDelete={() => { onDeleteMany(sel.selected); sel.exit(); }} />
      )}
      <div className="screen-foot" />
    </div>
  );
}
