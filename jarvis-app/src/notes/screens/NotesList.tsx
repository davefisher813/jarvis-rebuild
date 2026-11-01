import { Fragment, useState, type ReactNode, useEffect } from "react";
import PageHeader, { BarAction, BarText } from "../../shared/PageHeader";
import LifeHeader, { OptionsButton, type HeaderView } from "../../shared/LifeHeader";
import HeadMenu from "../../shared/HeadMenu";
import OptionsSheet, { type OptionRow } from "../../shared/OptionsSheet";
import RowActionSheet, { type RowAction } from "../../shared/RowActionSheet";
import { deleteAskTitle } from "../deleteAsk";
import { useRowMenu } from "../../shared/useRowMenu";
import { Archive, Check, RotateCcw, Trash2, PenLine, Table, ListOrdered } from "../../shared/icons";
import { useSwipe, type SwipeState } from "../../shared/useSwipe";
import { useSelection } from "../../shared/useSelection";
import SelectBar from "../../shared/SelectBar";
import { catColor, catIds, catName } from "../../shared/categories";
import { CatChip, chipArea } from "../../shared/CatChipLine";
import WordFit from "../../shared/WordFit";
import { todayISO } from "../../tasks/grouping";
import { monthDay } from "../../money/bills";
import { pressable } from "../../shared/pressable";
import EntityStar, { useRemember } from "../../shared/EntityStar";
import { titleCase } from "../../shared/casing";
import LoadFailed from "../../shared/LoadFailed";

// NOTES, PORTED (Notes and Money catalog, 2026-09-02). The library rows of
// locked frame #46 (2026-08-18) are gone from this page; the note is a row
// in the same card every task list wears. The real iOS chrome (status bar,
// home indicator) is drawn by the device; this uses the canonical .screen
// container.
//
// THE AREA LIBRARY (Punch 12, Dave 2026-10-31: Direction B with the Capsule mark). The page is one section per area, the
// area's mark drawn ONCE, as the app's unified chip (shared/CatChipLine CatChip) on the section's head beside its count;
// notes with no area close the page under a muted "No Area" chip. A note row carries no mark at all: its title, one
// preview line, and its date, indented so its words start where the area's name starts inside the head's chip.

export interface NoteListItem {
  id: string;
  title: string;
  edited: number; // epoch ms of the last write; 0 when the store cannot say
  category: string; // which area section the note sits in
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
  // C-20: candidates JARVIS found and he has not used yet. Kept on the item for the note itself; a row never draws it
  // (Dave 2026-10-11: "counts never render inside note rows").
  found?: number;
  // The note's first lines with words in them, headings left out (docModel contentLines). The row's second line is read
  // from these; absent, the row falls back to `first`.
  lines?: string[];
  // Wave 3b: in Recently Deleted.
  deleted?: boolean;
  // Issue #115: a template page, and which kind. Its row is the same row; its menu adds Export or Share and Duplicate.
  page?: import("../pages/pageModel").PageKind;
  // A page kept as the person's own template (Save as My Template): structure with no rows. The picker lists it.
  mine?: boolean;
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

// THE SWIPE ON A NOTE (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md). A note is a clean row:
//
//   tap          opens the note (a deleted note opens its menu instead, since there is no note to open)
//   swipe left   the row's ONE quickest verb (Archive; Unarchive in the Archived view; Restore in Recently Deleted),
//                then Delete (Delete Forever in Recently Deleted) behind it, never the only way
//   swipe right  nothing: a note has nothing to complete, so it opts out
//   long press   the context menu, every action again: Add a Line, File Under an Area, the verb, Delete
//
// There is no pill on the row. The gesture math is shared/useSwipe's and the held-row menu is shared/useRowMenu's.
type RowDrag = {
  dragging: boolean; style?: React.CSSProperties; handlers: React.HTMLAttributes<HTMLElement>;
  /** The tray is showing (or the row is mid-drag): a tap closes it instead of opening the note. */
  open: boolean; close: () => void;
  /** Opens the context menu, for a row whose tap has no note to open. */
  openMenu: () => void;
};
interface NoteVerb { label: string; icon: ReactNode; run: () => void }
function NoteSwipeRow({ enabled, label, verb, onDelete, forever = false, holdActions, children }: {
  /** The note's own name, so the tray says WHICH note it acts on. */
  enabled: boolean; label: string;
  verb?: NoteVerb; onDelete?: () => void; forever?: boolean;
  /** The long-press menu: every action again. */
  holdActions: RowAction[];
  children: (drag: RowDrag) => ReactNode;
}) {
  const slots = (verb ? 1 : 0) + (onDelete ? 1 : 0);
  const rowMenu = useRowMenu({ title: label, actions: holdActions, enabled, swipeEnabled: enabled && slots > 0 });
  const swipe = useSwipe({ revealW: slots * 88, enabled: enabled && slots > 0, onLongPress: rowMenu.onLongPress });
  const { handlers, sheet } = rowMenu.bind(swipe);
  return (
    <div className="task-swipe">
      {verb && (
        <button className="task-verb" onClick={() => swipe.closeThen(verb.run)} aria-label={verb.label + " " + label}>
          {verb.icon}
          <span className="swipe-label">{verb.label}</span>
        </button>
      )}
      {onDelete && (
        <button className="task-del" onClick={() => swipe.closeThen(onDelete)} aria-label={(forever ? "Delete forever: " : "Delete ") + label}>
          <Trash2 className="ic" />
          <span className="swipe-label">{forever ? "Forever" : "Delete"}</span>
        </button>
      )}
      {children({ dragging: swipe.dragging, style: swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined, handlers,
        open: swipe.open || swipe.dx !== 0, close: () => swipe.closeThen(), openMenu: rowMenu.open })}
      {sheet}
    </div>
  );
}

const DAY = 24 * 60 * 60 * 1000;

// Which day a note was last touched, against the calendar, not the clock:
// a note edited at 11pm is "yesterday" at 1am, not "today" for two hours.
function dayDiff(edited: number, now: Date): number {
  const then = new Date(edited);
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  return Math.round((a - b) / DAY);
}

// "Edited Today" / "Yesterday" / "Aug 30" / "Aug 30, 2025". The one word
// "Edited" rides only the freshest case: on a dated row the date is the
// edit, and saying so on every line was the noise the catalog removed.
// Title Case, like every line the app writes (Dave 2026-09-26, the pass-off).
// A body that opens with a date ("Aug 24 · Attendees", the calendar's
// meeting note) hands that date to the row and the rest to the preview.
const LEADING_DATE = /^((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2})(?:,\s*\d{4})?(?!\d)\s*(?:\u00b7|\||:|-)?\s*/;
export function leadingDate(first: string): { date: string; rest: string } | null {
  const m = LEADING_DATE.exec(first.trim());
  if (!m) return null;
  const date = m[1]!.replace(/^([A-Z][a-z]{2})[a-z]*\.?/, "$1");
  return { date, rest: first.trim().slice(m[0].length) };
}

// THE SECOND LINE IS ONE THING (Dave 2026-10-11): who the meeting was with, or the note's own words, never both and
// never a label with nothing after it. A meeting note opens with "Aug 24 · Attendees" and the names are typed after
// the label; with no names typed, that line says nothing and is skipped, and the row reads the next line instead.
// "With Wei and Sam Okafor" on the first line is the same fact said the other way. Only the first line can name the
// attendees, so a sentence further down that starts "With" stays a sentence.
const ATTENDEES = /^attendees\b[\s:\u00b7,-]*(.*)$/i;
const WITH = /^with\b[\s:]*(.*)$/i;
const NAME = /^[A-Z][\p{L}'.-]*(?:\s+[A-Z][\p{L}'.-]*)*$/u;
function namesIn(list: string, strict: boolean): string[] {
  const parts = list.split(/\s*(?:,|;|&|\band\b)\s*/).map((x) => x.trim()).filter(Boolean);
  if (strict && !parts.every((x) => NAME.test(x))) return [];
  return parts;
}
export function rowLine(lines: string[]): { date: string; with: string[]; preview: string } {
  let date = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.trim();
    if (i === 0) {
      const lead = leadingDate(line);
      if (lead) { date = lead.date; line = lead.rest; }
      const a = ATTENDEES.exec(line);
      if (a) { const names = namesIn(a[1]!, false); if (names.length) return { date, with: names, preview: "" }; continue; }
      const w = WITH.exec(line);
      if (w) { const names = namesIn(w[1]!, true); if (names.length) return { date, with: names, preview: "" }; }
    }
    if (line) return { date, with: [], preview: line };
  }
  return { date, with: [], preview: "" };
}

export function editedLabel(edited: number, now: Date = new Date()): string {
  if (!edited) return "";
  const d = dayDiff(edited, now);
  if (d <= 0) return "Edited Today";
  if (d === 1) return "Yesterday";
  const then = new Date(edited);
  const md = monthDay(todayISO(then));
  return then.getFullYear() === now.getFullYear() ? md : `${md}, ${then.getFullYear()}`;
}

// THREE WAYS TO GROUP THE LIBRARY (Dave 2026-10-31, the phone check of Punch 12: "group by Area, by Date, and by Subject").
// Area stays the default and is the only one whose heads wear the area's chip; Date and Subject heads are the page's plain
// quiet head with a count. Subject is the note's own tags (types.ts: "the user's own words"): a note sits under its first
// tag, so it is listed once, and a note with no tag closes the page under No Subject. Date is the day it was last touched:
// Today, Yesterday, Earlier This Week, then by month ("September", "August 2025"); a note the store cannot date goes last.
// Inside every section a pinned note leads, then newest first, as the page has always read.
export type NoteGrouping = "area" | "date" | "subject";
export const GROUPINGS: { value: NoteGrouping; label: string }[] = [
  { value: "area", label: "By Area" },
  { value: "date", label: "By Date" },
  { value: "subject", label: "By Subject" },
];
const GROUP_KEY = "jarvis.notes.groupBy.v1";
function readGrouping(): NoteGrouping {
  try {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(GROUP_KEY) : null;
    return v === "date" || v === "subject" ? v : "area";
  } catch { return "area"; }
}
function keepGrouping(v: NoteGrouping) {
  try { window.localStorage.setItem(GROUP_KEY, v); } catch { /* private mode: it resets to Area, which is the default */ }
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export type NoteGroup<T> = { key: string; area: string | null; label?: string; items: T[] };
export function groupNotes<T extends Pick<NoteListItem, "category" | "edited" | "tags" | "pinned" | "archived" | "deleted">>(
  shown: T[], by: NoteGrouping, now: Date, areaOrder: string[] = catIds(), areaName: (id: string) => string = catName,
): NoteGroup<T>[] {
  const leads = (n: T) => !!n.pinned && !n.archived && !n.deleted;
  const pinFirst = (items: T[]) => [...items.filter(leads), ...items.filter((n) => !leads(n))];
  const buckets = new Map<string, T[]>();
  const put = (k: string, n: T) => { const l = buckets.get(k) ?? []; l.push(n); buckets.set(k, l); };
  if (by === "date") {
    // Keys sort newest first: "0" today, "1" yesterday, "2" this week, then "m:YYYY-MM" descending, "~" undated last.
    const label = new Map<string, string>();
    for (const n of shown) {
      if (!n.edited) { put("~", n); label.set("~", "No Date"); continue; }
      const d = dayDiff(n.edited, now);
      if (d <= 0) { put("0", n); label.set("0", "Today"); continue; }
      if (d === 1) { put("1", n); label.set("1", "Yesterday"); continue; }
      if (d < 7) { put("2", n); label.set("2", "Earlier This Week"); continue; }
      const t = new Date(n.edited);
      const k = `m:${9999 - t.getFullYear()}-${String(11 - t.getMonth()).padStart(2, "0")}`;
      put(k, n);
      label.set(k, MONTHS[t.getMonth()]! + (t.getFullYear() === now.getFullYear() ? "" : " " + t.getFullYear()));
    }
    return [...buckets.keys()].sort().map((k) => ({ key: k, label: label.get(k)!, area: null, items: pinFirst(buckets.get(k)!) }));
  }
  if (by === "subject") {
    const word = new Map<string, string>();
    for (const n of shown) {
      const t = (n.tags ?? []).map((x) => x.trim()).find(Boolean);
      const k = t ? t.toLowerCase() : "";
      if (t && !word.has(k)) word.set(k, t);
      put(k, n);
    }
    const named = [...buckets.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b));
    return [
      ...named.map((k) => ({ key: "s:" + k, area: null, label: titleCase(word.get(k)!), items: pinFirst(buckets.get(k)!) })),
      ...(buckets.has("") ? [{ key: "s:", area: null, label: "No Subject", items: pinFirst(buckets.get("")!) }] : []),
    ];
  }
  // An area with no live name is not a section of its own, so it never shows a borrowed colour.
  for (const n of shown) {
    const key = chipArea(n.category) ? n.category : "";
    put(key, n);
  }
  const order = [...buckets.keys()].filter((k) => k).sort((a, b) => {
    const ia = areaOrder.indexOf(a), ib = areaOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0 || ib >= 0) return ia >= 0 ? -1 : 1;
    return areaName(a).localeCompare(areaName(b));
  });
  return [
    ...order.map((k) => ({ key: k, area: k as string | null, items: pinFirst(buckets.get(k)!) })),
    ...(buckets.has("") ? [{ key: "", area: null, items: pinFirst(buckets.get("")!) }] : []),
  ];
}

/** Hands a note row its Remember toggle. `row` is a render function, not a component, so the hook lives here: one per note. */
function RememberGate({ id, title, children }: { id: string; title: string; children: (remember: ReturnType<typeof useRemember>) => ReactNode }) {
  return <>{children(useRemember("note", id, title))}</>;
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
  onDeleteManyForever,
  onFile,
  onAppend,
  onArchive,
  onRestore,
  onDeleteForever,
  onDelete,
  onBlankNote,
  onImportTable,
  onPasteRows,
  onShare,
  onDuplicate,
  loadFailed = false,
  onRetryLoad,
}: {
  notes: NoteListItem[];
  /** The first read failed and nothing is on screen: the page says so, with Retry (shared/LoadFailed), where it used to draw an empty library. */
  loadFailed?: boolean;
  onRetryLoad?: () => void;
  onOpen?: (id: string) => void;
  onNewNote?: () => void;
  // THE CLIP (Dave 2026-09-02: "both pages need to have a pic/file upload
  // button"): a photo or file becomes a new note, titled after it, opened.
  onAddFile?: () => void;
  uploading?: boolean;
  onDeleteMany?: (ids: string[]) => void;
  // Select mode's Delete inside Recently Deleted: the same permanent delete
  // the row's Forever swipe runs, for the ticked notes.
  onDeleteManyForever?: (ids: string[]) => void;
  // The long-press menu's moves: file under an area, delete one.
  onFile?: (id: string) => void;
  onAppend?: (id: string) => void;
  /** Swipe left's quickest verb: archive a note, or bring it back from the Archived view. */
  onArchive?: (id: string, archived: boolean) => void;
  onRestore?: (id: string) => void;
  onDeleteForever?: (id: string) => void;
  onDelete?: (id: string) => void;
  // NOTES HOME, EXISTING MATERIAL FIRST (issue #115): search, pinned and recent lead; starting something new follows them.
  onBlankNote?: () => void;
  onImportTable?: () => void;
  onPasteRows?: () => void;
  // A template page's row menu: export or share it, or make a copy.
  onShare?: (id: string) => void;
  onDuplicate?: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const now = new Date();
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [optsOpen, setOptsOpen] = useState(false);
  // CLICK-THROUGH AUDIT 2026-09-29: Import or Attach closed the menu and went
  // straight to the phone's file sheet, which a driver cannot see, so the menu
  // just seemed to vanish. It now lands on a sheet of our own; its row opens the
  // picker inside that tap. The file input lives in NotesFlow and stays mounted.
  const [importOpen, setImportOpen] = useState(false);
  /** Which sub-list the options sheet is showing: the areas, or the tags.
   *  Null is the sheet's own list of rows. */
  /** The area cut, composing with whichever view is chosen. Null is every
   *  area, which is what the menu calls All Areas. */
  const [area, setArea] = useState<string | null>(null);
  /** How the sections are cut (Area, Date or Subject), kept on this device. */
  const [groupBy, setGroupBy] = useState<NoteGrouping>(readGrouping);
  // Newest first, always (Apple Notes' own order). A note the store cannot
  // date keeps the order the store gave it, behind every dated one.
  const ordered = [...notes].sort((a, b) => b.edited - a.edited);
  // C-18: archived notes leave every list except the Archived filter and
  // search; the other chips narrow the live notes.
  // Recently Deleted is its own room: nothing there shows in any other view,
  // and a search from All does not reach it. Searching inside the Recently
  // Deleted view does (see pool below). Reworded 2026-10-05.
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
  // The cuts compose, in the order they are chosen: the view (or tag) says
  // which notes are in play, the area says which of those are this one's.
  // 2026-10-04: a search runs INSIDE them. It used to start from every kept
  // note whatever the View and Tag menus said, so those two menus did
  // nothing the moment the box had text, and the scope line named a view it
  // had not searched. With no cut chosen (All) it still reaches the archive
  // (S6-Q37), because that is what All plus a search has always meant; any
  // chosen view or tag is the whole pool, Recently Deleted included.
  const pool = query && filter.kind === "all" ? kept : inView;
  // S6-Q37: title OR body, same two-part rule search.ts's noteHas uses.
  const searched = query ? pool.filter((n) => n.title.toLowerCase().includes(query) || n.body.toLowerCase().includes(query)) : pool;
  const shown = area ? searched.filter((n) => n.category === area) : searched;
  const viewWord = filter.kind === "tag" ? "#" + filter.tag
    : filter.kind === "archived" ? "Archived"
    : filter.kind === "deleted" ? "Recently Deleted"
    : VIEWS.find((v) => v.key === filter.kind)?.label ?? "All";
  // Recently Deleted's bulk Delete is the one that cannot be undone (below).
  const inDeleted = filter.kind === "deleted";
  // ONE confirm in front of EVERY user-initiated delete (issue 105): the swipe
  // tray, the long-press menu, Select mode, and Recently Deleted's Forever
  // paths all open the same sheet, and nothing is written until its
  // destructive button is tapped. Before this only Select inside Recently
  // Deleted asked, so the same Delete sometimes confirmed and sometimes did
  // not. A soft delete is still restorable (the Undo toast stays), so its
  // sheet says so; only the permanent one says "No Undo".
  const [ask, setAsk] = useState<{ ids: string[]; forever: boolean; fromSelect: boolean } | null>(null);
  const askDelete = (ids: string[], forever: boolean, fromSelect = false) => {
    if (ids.length) setAsk({ ids, forever, fromSelect });
  };
  // The SEARCHED list, not the whole one. Select All while a search is
  // narrowing the page must mean the notes on screen: deleting the ones
  // hidden behind a query would be the worst possible version of this.
  const sel = useSelection(shown.map((n) => n.id));

  // THE AREA SECTIONS (Punch 12, Dave 2026-10-31). One section per area, in the order his areas are kept (Settings),
  // any other named area after them by name, and the notes with no area (or an area with no live name) last, under No
  // Area. Inside a section a pinned note leads, then newest first, as the page has always read. The day heads (Pinned,
  // Today, Yesterday, Earlier) went with the grouping they belonged to; Pinned is still a view in the header's menu.
  const groups = groupNotes(shown, groupBy, now);

  const row = (n: NoteListItem, remember: ReturnType<typeof useRemember>) => {
    const picked = sel.isSelected(n.id);
    // ONE DATE PER ROW (Dave 2026-10-11: "Aug 24 · Attendees OCT 1" was two
    // dates). A meeting note's body opens with the meeting's own date; that is
    // the date that means something, so it moves out of the preview into the
    // date slot and the edit date is not drawn. Any other note keeps the date
    // it was last touched, said once as before.
    const said = rowLine(n.lines ?? (n.first ? [n.first] : []));
    const second = said.with.length ? "With: " + said.with.join(", ") : said.preview;
    // ONE DATE, ON THE TITLE LINE (the approved mock, 2026-10-09 .note-date): when it was last touched, at the right of
    // the title. A meeting note's own opening date ("Aug 24 · Attendees") is taken off its preview, so the row never
    // says two dates. The heads are areas now (Punch 12), never a day, so every dated row says its own date.
    const when = editedLabel(n.edited, now);
    const body = (drag: RowDrag) => (
      <div
        className={"task-row p2 note-row" + (drag.dragging ? " swiping" : "")}
        {...pressable(() => {
          if (sel.active) { sel.toggle(n.id); return; }
          // A row whose tray is showing closes it instead of opening the note.
          if (drag.open) { drag.close(); return; }
          // A deleted note has no note to open: its tap is its menu (Restore, Delete Forever).
          if (n.deleted) { drag.openMenu(); return; }
          onOpen?.(n.id);
        })}
        style={drag.style}
        {...drag.handlers}>
        {/* The selection box takes the leading column: on a row with a glyph
            it is the glyph's column, on the line row it is the check column
            every task row keeps for exactly this. */}
        {/* C-50: the Remember star leads the row. */}
        {/* THE STAR HANGS IN THE GUTTER ONLY WHILE THE NOTE IS REMEMBERED (2026-10-05, the review: an empty star on every row sat 6px from
            the card's edge, thin and low in contrast, and took a column of its own). Remembering it is the long press, as on a task row. */}
        {!sel.active && <EntityStar entityType="note" entityId={n.id} title={n.title} quiet />}
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
        ) : null}
        <div className="task-title">
          {/* HIS TITLE, SHOWN IN TITLE CASE (Dave 2026-09-26, the pass-off:
              typed titles are shown in Title Case everywhere and stored
              unchanged). Only the drawn text is cased: n.title stays raw for
              search, selection and the aria labels. */}
          {/* THE APPROVED ROW (Dave 2026-10-11, "match the mock exactly": unified-chip-system-mockup-2026-10-09). Line
              one is the title, and the date small and letter-spaced at its right. Line two is the note's preview (the
              area chip that sat beside it moved to the section head, Punch 12). */}
          <div className="note-line1">
            <span className="task-name">{titleCase(n.title)}</span>
            {when && <span className="note-date">{when}</span>}
          </div>
          {/* The preview is one thing (rowLine): who the meeting was with, or the note's own words; never a label with
              nothing after it. It gives up whole words to fit (WordFit). Tags and what JARVIS found are not on the row. */}
          {/* ONE ROW GRAMMAR ON EVERY ROW (Dave 2026-10-18, Notes screen order item 5): a note with nothing written says so in
              the preview's slot, so the rhythm never breaks. */}
          {/* NO MARK ON THE ROW (Punch 12, Dave 2026-10-31: the capsule once per area, on the head, "is the whole point").
              The chip that led this line is gone; the section's head names the area once. Line two is the preview alone. */}
          <div className="r-k note-sub">
            {second
              ? <WordFit text={second} className="r-goal note-preview" data-sentence="" />
              : <span className="r-goal note-preview note-preview-none">Empty Note</span>}
          </div>
        </div>
        {!sel.active && !n.deleted && <div className="chev"></div>}
      </div>
    );
    // THE MENU, EVERY ACTION AGAIN (the long press; never the only way to anything essential). A deleted note's menu is
    // its whole detail: Restore, then Delete Forever.
    if (n.deleted) {
      const menu: RowAction[] = [
        ...(onRestore ? [{ label: "Restore", onPick: () => onRestore(n.id) }] : []),
        ...(onDeleteForever ? [{ label: "Delete Forever", destructive: true, onPick: () => askDelete([n.id], true) }] : []),
      ];
      return menu.length ? (
        <NoteSwipeRow key={n.id} enabled={!sel.active} label={n.title}
          verb={onRestore ? { label: "Restore", icon: <RotateCcw className="ic" />, run: () => onRestore(n.id) } : undefined}
          onDelete={onDeleteForever ? () => askDelete([n.id], true) : undefined} forever holdActions={menu}>
          {body}
        </NoteSwipeRow>
      ) : <Fragment key={n.id}>{body({ dragging: false, handlers: {}, open: false, close: () => {}, openMenu: () => {} })}</Fragment>;
    }
    const unarchive = !!n.archived;
    const menu: RowAction[] = [
      ...(remember && !sel.active ? [{ label: remember.on ? "Forget" : "Remember", onPick: () => void remember.run() }] : []),
      ...(onAppend && !n.page ? [{ label: "Add a Line", onPick: () => onAppend(n.id) }] : []),
      ...(onFile ? [{ label: "File Under an Area", onPick: () => onFile(n.id) }] : []),
      ...(n.page && onShare ? [{ label: "Export or Share", onPick: () => onShare(n.id) }] : []),
      ...(n.page && onDuplicate ? [{ label: "Duplicate Page", onPick: () => onDuplicate(n.id) }] : []),
      ...(onArchive ? [{ label: unarchive ? "Unarchive" : "Archive", onPick: () => onArchive(n.id, !unarchive) }] : []),
      ...(onDelete ? [{ label: "Delete", destructive: true, onPick: () => askDelete([n.id], false) }] : []),
    ];
    return menu.length ? (
      <NoteSwipeRow key={n.id} enabled={!sel.active} label={n.title}
        verb={onArchive ? { label: unarchive ? "Unarchive" : "Archive", icon: <Archive className="ic" />, run: () => onArchive(n.id, !unarchive) } : undefined}
        onDelete={onDelete ? () => askDelete([n.id], false) : undefined} holdActions={menu}>
        {body}
      </NoteSwipeRow>
    ) : <Fragment key={n.id}>{body({ dragging: false, handlers: {}, open: false, close: () => {}, openMenu: () => {} })}</Fragment>;
  };

  const failedEmpty = loadFailed && notes.length === 0;
  return (
    <div className="screen ruled notes-list">
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
            // The view or tag the search ran inside, said as it is (Archived,
            // Recently Deleted and a tag used to print "All"), and the one
            // button that widens it to the whole library.
            // Title Case like every other page's scope words and widen button
            // (Tasks "Today Tasks" / "Search All Tasks", Reminders "Search All
            // Areas"); it read "All notes" and "Search all notes" (2026-10-05).
            where: `${viewWord} Notes${area ? ` in ${catName(area) || "This Area"}` : ""}`,
            ...(filter.kind !== "all" || area ? { onAll: () => { setFilter({ kind: "all" }); setArea(null); }, allLabel: "Search All Notes" } : {}),
          } : undefined}
          // AREA AND TAG, STACKED (Dave 2026-09-17: "Make multiple dropdown
          // chips like areas in the most logical way possible. Stack
          // dropdowns next to each other"). Both were chips in the wrapping
          // row this header replaced, then rows in the options sheet; they
          // are the two lists on this page that grow with the library, which
          // is exactly what a dropdown is for and a chip is not.
          drops={(
            <>
              {/* THE GROUPING SWITCH (Dave 2026-10-31): how the sections are cut. Always here, and first, since it shapes the page. */}
              <HeadMenu
                ariaLabel="Group Notes"
                value={groupBy}
                options={GROUPINGS}
                onPick={(v) => { const g = v as NoteGrouping; setGroupBy(g); keepGrouping(g); }}
              />
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
          )}

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
          A library index is information, not a verb. */}
      {failedEmpty && <LoadFailed what="Your Notes" onRetry={() => onRetryLoad?.()} />}
      {/* THE AREA'S HEAD (Punch 12): the section head every page wears (.sh2, its dotted leader and its count), with the
          area's unified chip where the head's words go. That chip is the area's ONE mark on the page. */}
      {groups.map((g) => (
        <Fragment key={g.key}>
          {groupBy === "area" ? (
            <div className="sh2 sh2-quiet note-area-head" role="heading" aria-level={2}>
              <CatChip category={g.area} empty="No Area" />
              <span className="n">{g.items.length}</span>
            </div>
          ) : (
            <div className="sh2 sh2-quiet note-group-head" role="heading" aria-level={2}>
              <span className="t">{g.label}</span>
              <span className="n">{g.items.length}</span>
            </div>
          )}
          <div className="pad-x"><div className="card list-card-ruled note-card">{g.items.map((n) => <RememberGate key={n.id} id={n.id} title={n.title}>{(remember) => row(n, remember)}</RememberGate>)}</div></div>
        </Fragment>
      ))}
      {query && shown.length === 0 && !failedEmpty && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="task-row p2"><div className="task-title"><span className="task-name">No notes match &ldquo;{q.trim()}&rdquo;</span></div></div>
        </div></div>
      )}
      {/* THEN SOMETHING NEW (issue #115, Notes home order: Search, Pinned, Recent, the area filter, then New Note, Use a
          Template, Import). What he already has leads the page; the three ways to start sit under it, in the ordinary
          views, out of the way of a search, a selection and the archive. */}
      {!query && !sel.active && !failedEmpty && (filter.kind === "all" || filter.kind === "pinned" || filter.kind === "unfiled") && (onBlankNote || onNewNote) && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Start Something</span></div>
          {/* Doors to three screens, in the grouped card the Connections screen's Actions card already wears. */}
          <div className="pad-x"><div className="card list-card-ruled set-card">
            {([
              onBlankNote ? { key: "new", name: "New Note", cat: "yellow", Icon: PenLine, run: onBlankNote } : null,
              onNewNote ? { key: "template", name: "Use a Template", cat: "blue", Icon: ListOrdered, run: onNewNote } : null,
              onImportTable || onAddFile ? { key: "import", name: "Import", cat: "green", Icon: Table, run: () => setImportOpen(true) } : null,
            ].filter(Boolean) as { key: string; name: string; cat: string; Icon: typeof PenLine; run: () => void }[]).map(({ key, name, cat, Icon, run }) => (
              <div className="row set-row" key={key} {...pressable(run)}>
                <div className={"proj-icon " + (key === "new" ? "note-new-tile" : "cat-bg-" + cat)}><Icon className="ic" /></div>
                <div className="conn-name">{name}</div>
                <div className="chev"></div>
              </div>
            ))}
          </div></div>
        </>
      )}
      {/* EVERYTHING THAT IS NOT A WORKFLOW STATE (handoff rule 7: "Notes-
          specific tools, including import and Recently Deleted, remain
          available"). Area and Tag each open their own list of answers in
          this same sheet rather than a second sheet on top of it. */}
      {optsOpen && (
        <OptionsSheet title="Notes Options" rows={([
          // Recently Deleted offers it only where there is a Delete Forever
          // to run: the bulk Delete there used to re-delete notes that were
          // already deleted, report success, and Undo put them back in Notes.
          ...(onDeleteMany && shown.length > 0 && (!inDeleted || onDeleteManyForever) ? [{
            key: "select", label: "Select Notes",
            onClick: () => { setOptsOpen(false); sel.enter(); },
          }] : []),
          ...(onAddFile || onImportTable ? [{
            key: "file", label: uploading ? "Uploading" : "Import or Attach",
            onClick: () => { setOptsOpen(false); if (!uploading) setImportOpen(true); },
          }] : []),
        ] as OptionRow[])} onClose={() => setOptsOpen(false)} />
      )}
      {importOpen && (onAddFile || onImportTable) && (
        <RowActionSheet
          title="Import or Attach"
          actions={[
            ...(onImportTable ? [{ label: "A Roster from Sheets or Excel", onPick: onImportTable }] : []),
            ...(onPasteRows ? [{ label: "Paste Rows", onPick: onPasteRows }] : []),
            ...(onAddFile ? [{ label: onImportTable ? "Attach a Photo or PDF" : "Choose a File", onPick: onAddFile }] : []),
          ]}
          onCancel={() => setImportOpen(false)}
        />
      )}
      {onDeleteMany && (
        <SelectBar sel={sel} noun="Note" forever={inDeleted && !!onDeleteManyForever}
          // Notes confirm in this page, in front of the bar's Delete (the bar
          // itself stays Undo-only for Tasks and Mail). Recently Deleted's
          // Delete is the permanent one and says so; a live note's is not.
          onDelete={() => askDelete(sel.selected, inDeleted && !!onDeleteManyForever, true)} />
      )}
      {ask && (() => {
        const n = ask.ids.length;
        const one = n === 1;
        // RowActionSheet closes itself (onCancel) BEFORE it calls onPick, so
        // `ask` is already null by then; run closes over this render's copy.
        const run = () => {
          if (ask.forever) {
            if (one && !ask.fromSelect && onDeleteForever) onDeleteForever(ask.ids[0]!);
            else onDeleteManyForever?.(ask.ids);
          } else if (one && !ask.fromSelect && onDelete) onDelete(ask.ids[0]!);
          else onDeleteMany?.(ask.ids);
          if (ask.fromSelect) sel.exit();
        };
        return (
          <RowActionSheet
            // A sheet's title is an 11px caps label, never a sentence (the
            // 2026-09-26 caps ruling). Title Case, one short line, and "No
            // Undo" is the catalog's own word for the permanent one, joined
            // with a comma so the label is one phrase (2026-10-05). The
            // restorable one must not claim it cannot be undone.
            // One note is named (2026-10-13: the confirmation names the page being deleted).
            title={one
              ? deleteAskTitle(ordered.find((x) => x.id === ask.ids[0])?.title ?? "", ask.forever)
              : (ask.forever ? `Delete ${n} Notes for Good, No Undo` : `Delete ${n} Notes, Restore Within 30 Days`)}
            cancelFirst
            actions={[{
              label: ask.forever
                ? (one ? "Delete Note Forever" : `Delete ${n} Notes Forever`)
                : (one ? "Delete Note" : `Delete ${n} Notes`),
              destructive: true,
              onPick: run,
            }]}
            onCancel={() => setAsk(null)}
          />
        );
      })()}
      <div className="screen-foot" />
    </div>
  );
}
