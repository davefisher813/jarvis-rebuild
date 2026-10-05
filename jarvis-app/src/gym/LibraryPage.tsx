import { NAME_FIELD } from "../shared/nameField";
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LibraryRow } from "./libraryEdit";
import { rowDoor } from "../shared/rowDoor";
import GymSwipeRow from "./GymSwipeRow";
import { Tag } from "../shared/icons";
import { agoPhrase } from "./summary";
import { shortDate } from "../shared/dateFormat";
import SheetBar from "../shared/SheetBar";
import ActionSheet, { PickSheet, type PickItem, type SheetAction } from "./ActionSheet";
import ClassifySheet from "./ClassifySheet";
import ExerciseSheet from "./ExerciseSheet";
import BatchSheet from "./BatchSheet";
import { DuplicateBar, DuplicatesSheet } from "./DuplicateReview";
import { liftTitle, lineCase } from "../shared/casing";
import { findDuplicates, pairId, type DuplicatePair } from "./duplicates";
import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "./muscles";
import type { Exercise } from "./types";
import { EQUIPMENT_KINDS, EQUIPMENT_LABEL, loadStyleOf, type Equipment } from "./equipment";
import {
  classOf, needsMuscles, rowChips, valueLine, type Chip, type ClassStore, type Classification,
  type MovementPattern, type MuscleScope, MOVEMENTS, MOVEMENT_LABEL,
} from "./classify";
import { DEFAULT_SORT, defaultView, filterCount, floorLine, NO_FILTER, SORT_LABEL, viewRows, type LibraryFilter, type SortKey } from "./libraryView";

// EXERCISES (was "Your Lifts", renamed 2026-09-14 on Dave's word: "Rename
// 'Your Lifts' to 'Exercises' so the library covers all exercise types").
//
// The old page was a list of names with two pills on every row and nothing to
// do with any of it. This is the library as the handoff asks for it: the
// central place to organize exercises, edit classifications, resolve
// duplicates and reach history.
//
// THE ROW'S ANATOMY (§2), and every part of it is a decision:
//
//   name          white, wrapping, and the door to the exercise's own page
//   chips         muscle and equipment, each one a door INTO ITS OWN FIELD
//   Assign        amber, and only when there is no primary muscle at all
//   overflow      one menu, holding everything that is not an everyday tap
//
// What left: the Goal and Edit pills that rode every single row. Two pills
// times a hundred and fifty rows is three hundred controls competing with the
// one thing the row is for, and they pushed the name into a column narrow
// enough to clip it. Both live in the overflow now, which is the menu the
// handoff asked for by name.

const CHEV = <div className="chev" />;
const STAR = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" /></svg>
);

/** The colour an axis speaks in. One meaning per hue, so a row of chips can
 *  be read by colour before it is read by word. */
function chipTone(ch: Chip): string {
  if (ch.field === "muscles") return ch.tone === "primary" ? " lime" : " lime sec";
  if (ch.field === "equipment") return " violet";
  return "";
}

export default function LibraryPage({
  rows, store, todayIso, onOpen, onRename, onSetClass, onBatch, onMerge, onToggleHidden,
  onToggleFavorite, onSetGoal, onCreate, onDelete, dismissedDupes, onDismissDuplicate, onBack,
}: {
  rows: LibraryRow[];
  /** Every exercise's classification, by library key. */
  store: ClassStore;
  todayIso: string;
  onOpen: (row: LibraryRow) => void;
  onRename: (row: LibraryRow, name: string) => void;
  /** One write for the whole classification, with the scope the athlete
   *  picked when they corrected an existing assignment. */
  onSetClass: (row: LibraryRow, next: Classification, scope: MuscleScope) => void;
  /** Select mode's write: the whole store, already planned and previewed. */
  onBatch?: (next: ClassStore, changed: number) => void;
  /** Opens the reviewed merge flow on this pair. The page never merges. */
  onMerge: (keep: LibraryRow, fold: LibraryRow) => void;
  onToggleHidden: (row: LibraryRow) => void;
  onToggleFavorite?: (row: LibraryRow) => void;
  onSetGoal?: (row: LibraryRow) => void;
  /** CREATE ONE HERE (Dave 2026-09-17: "I should be able to create exercises
   *  here", then: "the modal should be a full add exercise modal").
   *
   *  It takes the WHOLE draft, because the sheet is now the same exercise
   *  editor the program day and the live session open -- name, measurement,
   *  equipment, counting, muscle, rest, ramp, note, and a planned strip. The
   *  first version asked two questions and left the other nine to a second
   *  sheet, which is two forms to fill for one lift. */
  onCreate?: (draft: Omit<Exercise, "id">) => void;
  /** DELETE FOR REAL (2026-10-01). Asks for the confirm; the page deletes
   *  nothing. The flow works out what would go, guards the exercise that is in
   *  a workout right now, and runs the write with an Undo. */
  onDelete?: (row: LibraryRow) => void;
  dismissedDupes?: string[];
  onDismissDuplicate?: (id: string) => void;
  onBack: () => void;
}) {
  // SEARCH, FILTER AND SORT LIVE ABOVE THE EDITORS (§3: "Preserve search,
  // filters, and scroll position after edits"). They are this component's own
  // state and no editor unmounts it, so saving a classification returns the
  // athlete to the same filtered list at the same place -- which is what
  // makes classifying forty exercises in one sitting possible at all.
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [renaming, setRenaming] = useState<LibraryRow | null>(null);
  const [draft, setDraft] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  const [classing, setClassing] = useState<{ row: LibraryRow; open: Chip["field"] } | null>(null);
  const [menu, setMenu] = useState<LibraryRow | null>(null);
  const [merging, setMerging] = useState<LibraryRow | null>(null);
  const [dupesOpen, setDupesOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  // THE LIST DOES NOT YANK A ROW OUT FROM UNDER YOU (§4: "If the exercise no
  // longer belongs in the active Missing muscles filter, confirm the save
  // before removing it from that filtered list").
  //
  // Classifying forty exercises from the Missing Muscles filter means every
  // save deletes the row you just touched, the list jumps, and your thumb is
  // now over a different exercise. So a row you just saved STAYS, marked
  // Saved, until you change the filter. Nothing is hidden by this -- the row
  // is real and the filter is honest again the moment it is re-applied.
  const [justSaved, setJustSaved] = useState<string[]>([]);

  /** The create sheet, which is the full exercise editor. */
  const [creating, setCreating] = useState(false);
  const openCreate = () => setCreating(true);
  /** The rows as the exercise sheet's autocomplete reads them. No history
   *  attached: this list exists to stop a duplicate being typed, not to
   *  prefill last week's numbers. */
  const pickables = useMemo(
    () => rows.map((r) => ({
      key: r.key, name: r.name, kind: r.kind,
      ...(r.exerciseKey ? { exerciseKey: r.exerciseKey } : {}),
      ...(r.unit ? { unit: r.unit } : {}),
      lastUsed: 0, lastSets: [],
    })),
    [rows],
  );

  // A classification nobody has written yet still shows what the athlete told
  // the exercise sheet: the equipment on its most recent sighting, read
  // through the same migration everything else reads it through.
  const classFor = (r: LibraryRow): Classification => classOf(store, r, loadStyleOf(r));

  const dupes: DuplicatePair[] = useMemo(
    () => (onDismissDuplicate ? findDuplicates(rows, dismissedDupes ?? []) : []),
    [rows, dismissedDupes, onDismissDuplicate],
  );
  const dupeKeys = useMemo(() => {
    const s = new Set<string>();
    for (const d of dupes) { s.add(d.keep.key); s.add(d.fold.key); }
    return s;
  }, [dupes]);

  // THE OPENING LIST IS THE BADGE'S LIST (2026-10-01). With nothing typed, no
  // filter on and the opening order, the page asks libraryView.defaultView,
  // the same function the Health dashboard's Exercises count asks, so the two
  // cannot drift. Any filter, search or other order is the page's own.
  const opening = filter.q.trim() === "" && filterCount(filter) === 0 && !filter.showHidden && !filter.showArchived && sort === DEFAULT_SORT;
  const openingCount = useMemo(() => defaultView(rows, store).rows.length, [rows, store]);
  const view = useMemo(
    () => (opening ? defaultView(rows, store) : viewRows(rows, store, filter, sort, dupeKeys)),
    [opening, rows, store, filter, sort, dupeKeys],
  );
  // A just-saved row is re-admitted in the list's own order rather than pinned
  // to the top, so nothing else moves either.
  const shown = useMemo(() => {
    if (!justSaved.length) return view.rows;
    const inView = new Set(view.rows.map((r) => r.key));
    const held = rows.filter((r) => justSaved.includes(r.key) && !inView.has(r.key));
    if (!held.length) return view.rows;
    return viewRows([...view.rows, ...held], store, { q: "" }, sort, dupeKeys).rows;
  }, [view.rows, justSaved, rows, store, sort, dupeKeys]);
  const missingCount = useMemo(() => rows.filter((r) => needsMuscles(classOf(store, r))).length, [rows, store]);

  const pickedRows = useMemo(() => shown.filter((r) => picked.includes(r.key)), [shown, picked]);
  const mergeItems: PickItem[] = merging
    ? rows
      .filter((r) => r.key !== merging.key && r.kind === merging.kind)
      // A lift never done shows no sub at all: a line that states nothing is
      // not a fact (§AK).
      .map((r) => ({ id: r.key, label: liftTitle(r.name), ...(r.sessions > 0 ? { sub: lineCase(`${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}`) } : {}) }))
    : [];

  const setF = (patch: Partial<LibraryFilter>) => { setJustSaved([]); setFilter((f) => ({ ...f, ...patch })); };

  const menuActions = (r: LibraryRow): SheetAction[] => [
    { label: "Edit Details", onClick: () => setClassing({ row: r, open: "muscles" }) },
    { label: "Rename", onClick: () => { setRenaming(r); setDraft(liftTitle(r.name)); } },
    ...(onSetGoal ? [{ label: "Set Goal", onClick: () => onSetGoal(r) }] : []),
    { label: "Merge Into Another Exercise", onClick: () => setMerging(r) },
    ...(onToggleFavorite ? [{ label: r.favorite ? "Remove From Favorites" : "Add to Favorites", onClick: () => onToggleFavorite(r) }] : []),
    { label: r.hidden ? "Offer It Again" : "Hide From Suggestions", onClick: () => onToggleHidden(r) },
    ...(onDelete ? [{ label: "Delete Exercise", onClick: () => onDelete(r), destructive: true }] : []),
  ];

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Exercises</div>
        {/* §7: "30 Exercises, each with its history" was a sentence doing a
            badge's job. This is the badge.
            AND IT IS NOT RED (2026-09-16, the polish handoff: "library count
            neutral, not red"). .nav-action is the tint, because a bar action
            is a verb you can press; this is a count of what is on the page,
            which is LAW L1's other half -- red is a verb, never a status.
            It reads in the quiet ink a fact wears, like every other count
            in the app's section heads. */}
        <span className="nav-action nav-count">{openingCount}</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Exercises Yet</div>
          <div className="empty-sub">Every exercise you add to a program or log in a session lands here</div>
          {onCreate && <button className="btn btn-primary btn-launch" onClick={openCreate}>Add Exercise</button>}
        </div>
      ) : (
        <>
          <div className="pad-x ex-search">
            <input
              className="xs-input"
              type="search"
              value={filter.q}
              placeholder="Search Names and Aliases"
              aria-label="Search Exercises"
              onChange={(e) => setF({ q: e.target.value })}
            />
          </div>

          <div className="pad-x ex-bar">
            <button type="button" className={"pill-act" + (filtersOpen ? " on" : "")} aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((v) => !v)}>
              {filtersOpen ? "Hide Filters" : "Filters"}
            </button>
            <button type="button" className="pill-act" onClick={() => { setJustSaved([]); setSort(sort === "recent" ? "name" : sort === "name" ? "most" : "recent"); }}>
              {SORT_LABEL[sort]}
            </button>
            {onBatch && (
              <button type="button" className={"pill-act" + (selecting ? " on" : "")}
                onClick={() => { setSelecting((v) => !v); setPicked([]); }}>
                {selecting ? "Done Selecting" : "Select"}
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="pad-x"><div className="card xs-group">
              {/* row-tap: chip strip, every inch of it is one of the filter chips */}
              <div className="row xs-row">
                <div className="chip-row">
                  <button type="button" className={"chip" + (filter.favorites ? " active" : "")} aria-pressed={!!filter.favorites}
                    onClick={() => setF({ favorites: !filter.favorites })}>Favorites</button>
                  <button type="button" className={"chip" + (filter.missing ? " active" : "")} aria-pressed={!!filter.missing}
                    onClick={() => setF({ missing: !filter.missing })}>{`Missing Muscles${missingCount ? " " + missingCount : ""}`}</button>
                  {dupes.length > 0 && (
                    <button type="button" className={"chip" + (filter.dupes ? " active" : "")} aria-pressed={!!filter.dupes}
                      onClick={() => setF({ dupes: !filter.dupes })}>Possible Duplicates</button>
                  )}
                  <button type="button" className={"chip" + (filter.showHidden ? " active" : "")} aria-pressed={!!filter.showHidden}
                    onClick={() => setF({ showHidden: !filter.showHidden })}>Hidden</button>
                  <button type="button" className={"chip" + (filter.showArchived ? " active" : "")} aria-pressed={!!filter.showArchived}
                    onClick={() => setF({ showArchived: !filter.showArchived })}>Archived</button>
                </div>
              </div>
              <div className="row xs-row"><div className="row-grow"><div className="conn-meta">Muscle</div></div></div>
              {/* row-tap: chip strip, every inch of it is one of the muscle chips */}
              <div className="row xs-row">
                <div className="chip-row">
                  {MUSCLE_GROUPS.map((m: MuscleGroup) => (
                    <button key={m} type="button" className={"chip" + (filter.muscle === m ? " active" : "")}
                      aria-pressed={filter.muscle === m}
                      onClick={() => setF({ muscle: filter.muscle === m ? undefined : m })}>{MUSCLE_LABEL[m]}</button>
                  ))}
                </div>
              </div>
              <div className="row xs-row"><div className="row-grow"><div className="conn-meta">Equipment</div></div></div>
              {/* row-tap: chip strip, every inch of it is one of the equipment chips */}
              <div className="row xs-row">
                <div className="chip-row">
                  {EQUIPMENT_KINDS.map((e: Equipment) => (
                    <button key={e} type="button" className={"chip" + (filter.equipment === e ? " active" : "")}
                      aria-pressed={filter.equipment === e}
                      onClick={() => setF({ equipment: filter.equipment === e ? undefined : e })}>{EQUIPMENT_LABEL[e]}</button>
                  ))}
                </div>
              </div>
              <div className="row xs-row"><div className="row-grow"><div className="conn-meta">Movement</div></div></div>
              {/* row-tap: chip strip, every inch of it is one of the movement chips */}
              <div className="row xs-row">
                <div className="chip-row">
                  {MOVEMENTS.map((m: MovementPattern) => (
                    <button key={m} type="button" className={"chip" + (filter.movement === m ? " active" : "")}
                      aria-pressed={filter.movement === m}
                      onClick={() => setF({ movement: filter.movement === m ? undefined : m })}>{MOVEMENT_LABEL[m]}</button>
                  ))}
                </div>
              </div>
              <div className="pad-x">
                <button type="button" className="btn btn-tertiary btn-block" onClick={() => setFilter({ q: filter.q })}>Clear Filters</button>
              </div>
            </div></div>
          )}

          {/* ONE COMPACT ROW, NOT THREE CARDS (§6). */}
          {!selecting && <DuplicateBar count={dupes.length} onOpen={() => setDupesOpen(true)} />}

          {selecting && (
            <div className="pad-x"><div className="card pad">
              <div className="row">
                {/* The count is the fact. "Tap exercises to select, then
                    classify them together" was an instruction for a mode you
                    are standing in, printed above the two buttons that do it
                    (2026-09-16, Dave: "this is not a manual"). */}
                <div className="row-grow">
                  <div className="conn-name">{`${picked.length} Selected`}</div>
                </div>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-secondary" disabled={picked.length === 0} onClick={() => setBatchOpen(true)}>Classify</button>
                <button type="button" className="btn btn-tertiary" onClick={() => setPicked(shown.map((r) => r.key))}>Select All Shown</button>
              </div>
            </div></div>
          )}

          {/* THE ADD IS THE HEAD'S (Dave 2026-10-05, locked; and 2026-09-17 before it: "the add exercise option should be at
              the top of the page not the bottom"). It was the first row of the list card, in the same in-list create every
              gym list wore. A section-level action is the head's one capsule, never a row inside the card. */}
          <div className="sh2 sh2-quiet"><span className="t">Your Lifts</span>
            {onCreate && !selecting && <button type="button" className="see-all pill-action" onClick={openCreate}>Add Exercise</button>}
          </div>
          <div className="pad-x"><div className="card list-card-ruled">
            {shown.map((r) => {
              const c = classFor(r);
              const chips = rowChips(c);
              const on = picked.includes(r.key);
              // The row's flags are ONE fact, the line's one grey (§AK): side
              // by side they were up to four runs of the same grey.
              const flags = [r.favorite && "Favorite", r.hidden && "Hidden", c.archived && "Archived", justSaved.includes(r.key) && "Saved"]
                .filter(Boolean).join(", ");
              const nag = needsMuscles(c);
              const assign = () => setClassing({ row: r, open: "muscles" });
              // THE ROW'S ONE QUICK VERB (Dave 2026-10-05, locked): the moment's action when the row has one (muscles still to
              // assign), Favorite otherwise; Delete behind it.
              const verb = nag
                ? { label: "Assign", name: "Assign Muscles", icon: <Tag className="ic" />, run: assign }
                : onToggleFavorite
                  ? { label: r.favorite ? "Unfavorite" : "Favorite", icon: STAR, run: () => onToggleFavorite(r) }
                  : null;
              return (
                // THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows
                // clickable"). Only the name used to open the exercise; the
                // facts, the gaps and the padding were dead. Selecting, the row
                // picks instead. Muscles, equipment and movement are FACTS now
                // (Dave 2026-10-05, locked: no pill in a row); the details sheet
                // that edits them is in the row's menu, and a row with no muscle
                // yet surfaces its one action in the key colour.
                <GymSwipeRow key={r.key} name={liftTitle(r.name)} enabled={!selecting}
                  verb={verb} onDelete={onDelete ? () => onDelete(r) : undefined}
                  menu={menuActions(r).map((a) => ({ label: a.label, destructive: a.destructive, onPick: a.onClick }))}>
                <div className={"row ex-row" + (on ? " on" : "")}
                  {...rowDoor(selecting
                    ? () => setPicked(on ? picked.filter((k) => k !== r.key) : [...picked, r.key])
                    : () => onOpen(r))}>
                  <div className="row-grow">
                    {/* The name wraps rather than clipping. */}
                    <div className="ex-name">{liftTitle(r.name)}</div>
                    {/* §7: "2 sessions · Last yesterday" was one grey line
                        doing two jobs. Two compact fields. */}
                    {(r.sessions > 0 || r.lastDate || flags) && (
                      <div className="facts">
                        {/* A count leads this line, so the word behind it takes
                            the capital (shared/casing.ts). Health polish 2026-09-16:
                            the mockup printed "1 sessions" on every row of this
                            list; the app has always had the singular right, and
                            now it has the capital too. The count is logged
                            work, so it wears the logged hue -- the same lime
                            the Day row's "done" word wears (§AM). When it last
                            happened is a neutral past date, so it is small
                            caps, as it is one tap deeper on the lift's own
                            page and on every other "last trained" in the app
                            (§AM F5). A lift never done says nothing here. */}
                        {r.sessions > 0 && <span className="fact lime">{lineCase(`${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}`)}</span>}
                        {r.lastDate && <span className="fact date">{agoPhrase(r.lastDate, todayIso)}</span>}
                        {flags && <span className="fact">{flags}</span>}
                      </div>
                    )}
                    {(chips.length > 0 || nag) && (
                      <div className="facts">
                        {chips.map((ch, i) => (
                          // EACH AXIS ITS OWN COLOUR (2026-09-16, Dave: "too
                          // much of the same color"). A muscle is what the
                          // lift trains and takes the lime the app already
                          // spends on work done; equipment takes the violet
                          // the session header's own equipment chip has always
                          // worn; the movement pattern is the least
                          // load-bearing axis and stays quiet. (Whether these
                          // axis hues stand under the 2026-09-22 Colour Key is
                          // Dave's call, queue #317.)
                          <span key={ch.label + i} className={"fact" + chipTone(ch)}>{ch.label}</span>
                        ))}
                        {/* THE ONE NAG, AS A STATE (Dave 2026-10-05, locked: no pill and no action text on a row that is not
                            yet due). A library with nothing classified would draw an action on every row, so the row says what
                            is missing in the amber a state wears; the action itself is the swipe's Assign Muscles. */}
                        {nag && <span className="fact amber">No Muscles Yet</span>}
                      </div>
                    )}
                    {/* NO OTHER TITLE ON THE ROW (Dave 2026-09-18: "also
                        (other title) needs to be deleted and never
                        render"). A merged-away name is history, not an
                        attribute of the exercise, and it read as a second
                        name for a row whose whole job is to carry one. */}
                  </div>
                  {selecting
                    ? <span className={"ex-check" + (on ? " on" : "")} aria-hidden="true" />
                    : (
                      <button type="button" className="ex-more" aria-label={`More for ${liftTitle(r.name)}`}
                        onClick={(e) => { e.stopPropagation(); setMenu(r); }}>
                        <span aria-hidden="true">···</span>
                      </button>
                    )}
                </div>
                </GymSwipeRow>
              );
            })}
            {shown.length === 0 && (
              <div className="row"><div className="row-grow"><div className="conn-meta">Nothing matches what you are filtering by</div></div></div>
            )}
          </div></div>

          <div className="pad-x"><div className="bp-sub">{floorLine(view, rows.length, filter)}</div></div>
        </>
      )}

      {/* CREATE, and it is the whole editor (Dave 2026-09-17: "the modal
          should be a full add exercise modal").

          The first version asked a name and a measurement and left the other
          nine axes to the classification sheet -- two forms to fill for one
          lift, and the second one easy to never open. This is the same
          ExerciseSheet the program day and the live session open, so a lift
          created here can carry its equipment, its counting, its muscle, its
          rest and its ramp the moment it exists. Nothing on it is required
          beyond the name, which is the rule every other exercise form keeps. */}
      {creating && onCreate && (
        <ExerciseSheet
          mode="new"
          // The page IS the library, so the sheet's autocomplete offers what
          // is already here: typing a name that exists lands you on that row
          // rather than minting a second one for the merge review to find.
          library={pickables}
          onSave={(draft) => { setCreating(false); onCreate(draft); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {/* RENAME, its own small sheet: it is the one edit that rewrites every
          record this exercise has, so it does not share a form with the
          classification, which rewrites none of them. */}
      {renaming && createPortal(
        <div className="sheet-scrim" onClick={() => setRenaming(null)}>
          <div className="card xs" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <SheetBar
              title={liftTitle(renaming.name)}
              onCancel={() => setRenaming(null)}
              saveLabel="Done"
              onSave={() => {
                const r = renaming;
                setRenaming(null);
                if (draft.trim() && draft.trim() !== r.name) onRename(r, liftTitle(draft.trim()));
              }}
            />
            <div className="sheet-form">
              <div className="grp xs-grp"><div className="eyebrow">Name</div></div>
              <div className="pad-x"><div className="card xs-group">
                <div className="row xs-row" onClick={() => renameRef.current?.focus()}>
                  <input ref={renameRef} className="xs-input" {...NAME_FIELD} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Exercise Name" />
                </div>
              </div></div>
              {/* The same reading: a real consequence, behind the question
                  it answers rather than under the field on every visit. */}
              <div className="pad-x"><details className="exp-more"><summary>About Renaming</summary><div className="bp-sub">
                Renaming keeps every session this exercise already has, and the old name stays searchable.
              </div></details></div>
              <div className="xs-foot" />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {classing && (
        <ClassifySheet
          name={classing.row.name}
          initial={classFor(classing.row)}
          open={classing.open}
          todayIso={todayIso}
          askScope={!needsMuscles(classFor(classing.row))}
          onSave={(next, scope) => {
            const r = classing.row;
            setClassing(null);
            // Held only while a filter could drop it. With no filter on, a
            // saved row is simply still there and needs no special case.
            if (filterCount(filter) > 0) setJustSaved((k) => (k.includes(r.key) ? k : [...k, r.key]));
            onSetClass(r, next, scope);
          }}
          onCancel={() => setClassing(null)}
        />
      )}

      {menu && (
        <ActionSheet title={liftTitle(menu.name)} actions={menuActions(menu)} onClose={() => setMenu(null)} />
      )}

      {merging && (
        <PickSheet
          title={"Merge " + merging.name + " Into"}
          searchLabel="Search Exercises"
          items={mergeItems}
          emptyText="No other exercise logs the same way, so there is nothing to merge into."
          onPick={(ids) => {
            const r = merging; setMerging(null);
            const survivor = ids[0] ? rows.find((x) => x.key === ids[0]) : undefined;
            if (survivor) onMerge(survivor, r);
          }}
          onCancel={() => setMerging(null)}
        />
      )}

      {dupesOpen && (
        <DuplicatesSheet
          pairs={dupes}
          sideOf={(r) => classFor(r)}
          onReview={(d) => { setDupesOpen(false); onMerge(d.keep, d.fold); }}
          onKeepSeparate={(id) => onDismissDuplicate?.(id)}
          onClose={() => setDupesOpen(false)}
        />
      )}

      {batchOpen && onBatch && (
        <BatchSheet
          rows={pickedRows}
          store={store}
          onSave={(next, changed) => { setBatchOpen(false); setPicked([]); setSelecting(false); onBatch(next, changed); }}
          onCancel={() => setBatchOpen(false)}
        />
      )}

      <div className="screen-foot" />
    </div>
  );
}

// capitalize() lived here until 2026-09-16. It existed to put the capital
// back on agoPhraseLower(), which is agoPhrase() with the capital taken off --
// a round trip through two functions to arrive where the first one started.
// This row prints the phrase on its own, so it asks for agoPhrase.
