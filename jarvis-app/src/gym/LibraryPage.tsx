import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LibraryRow } from "./libraryEdit";
import { rowDoor } from "../shared/rowDoor";
import { agoPhraseLower } from "./summary";
import { shortDate } from "../shared/dateFormat";
import SheetBar from "../shared/SheetBar";
import ActionSheet, { PickSheet, type PickItem, type SheetAction } from "./ActionSheet";
import ClassifySheet from "./ClassifySheet";
import BatchSheet from "./BatchSheet";
import { DuplicateBar, DuplicatesSheet } from "./DuplicateReview";
import { capAfterNumber } from "../shared/casing";
import { findDuplicates, pairId, type DuplicatePair } from "./duplicates";
import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "./muscles";
import { EQUIPMENT_KINDS, EQUIPMENT_LABEL, loadStyleOf, type Equipment } from "./equipment";
import {
  classOf, needsMuscles, rowChips, valueLine, type Chip, type ClassStore, type Classification,
  type MovementPattern, type MuscleScope, MOVEMENTS, MOVEMENT_LABEL,
} from "./classify";
import { filterCount, floorLine, NO_FILTER, SORT_LABEL, viewRows, type LibraryFilter, type SortKey } from "./libraryView";

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

export default function LibraryPage({
  rows, store, todayIso, onOpen, onRename, onSetClass, onBatch, onMerge, onToggleHidden,
  onToggleFavorite, onSetGoal, dismissedDupes, onDismissDuplicate, onBack,
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
  const [sort, setSort] = useState<SortKey>("recent");
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

  const view = useMemo(() => viewRows(rows, store, filter, sort, dupeKeys), [rows, store, filter, sort, dupeKeys]);
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
      .map((r) => ({ id: r.key, label: r.name, sub: r.sessions > 0 ? capAfterNumber(`${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}`) : "Never done" }))
    : [];

  const setF = (patch: Partial<LibraryFilter>) => { setJustSaved([]); setFilter((f) => ({ ...f, ...patch })); };

  const menuActions = (r: LibraryRow): SheetAction[] => [
    { label: "Edit Details", onClick: () => setClassing({ row: r, open: "muscles" }) },
    { label: "Rename", onClick: () => { setRenaming(r); setDraft(r.name); } },
    ...(onSetGoal ? [{ label: "Set Goal", onClick: () => onSetGoal(r) }] : []),
    { label: "Merge Into Another Exercise", onClick: () => setMerging(r) },
    ...(onToggleFavorite ? [{ label: r.favorite ? "Remove From Favorites" : "Add to Favorites", onClick: () => onToggleFavorite(r) }] : []),
    { label: r.hidden ? "Offer It Again" : "Hide From Suggestions", onClick: () => onToggleHidden(r) },
  ];

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Exercises</div>
        {/* §7: "30 Exercises, each with its history" was a sentence doing a
            badge's job. This is the badge. */}
        <span className="nav-action"><span className="n">{rows.length}</span></span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Exercises Yet</div>
          <div className="empty-sub">Every exercise you add to a program or log in a session lands here</div>
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
                <div className="row-grow">
                  <div className="conn-name">{`${picked.length} Selected`}</div>
                  <div className="conn-meta">Tap exercises to select, then classify them together</div>
                </div>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn-secondary" disabled={picked.length === 0} onClick={() => setBatchOpen(true)}>Classify</button>
                <button type="button" className="btn btn-tertiary" onClick={() => setPicked(shown.map((r) => r.key))}>Select All Shown</button>
              </div>
            </div></div>
          )}

          <div className="pad-x"><div className="card list-card-ruled">
            {shown.map((r) => {
              const c = classFor(r);
              const chips = rowChips(c);
              const on = picked.includes(r.key);
              return (
                // THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows
                // clickable"). Only the name used to open the exercise; the
                // facts, the gaps and the padding were dead. Selecting, the row
                // picks instead. The chips and the overflow keep their own verbs.
                <div className={"row ex-row" + (on ? " on" : "")} key={r.key}
                  {...rowDoor(selecting
                    ? () => setPicked(on ? picked.filter((k) => k !== r.key) : [...picked, r.key])
                    : () => onOpen(r))}>
                  <div className="row-grow">
                    {/* The name wraps rather than clipping. */}
                    <div className="ex-name">{r.name}</div>
                    {/* §7: "2 sessions · Last yesterday" was one grey line
                        doing two jobs. Two compact fields. */}
                    <div className="facts">
                      {/* A count leads this line, so the word behind it takes
                          the capital (shared/casing.ts). Health polish 2026-09-16:
                          the mockup printed "1 sessions" on every row of this
                          list; the app has always had the singular right, and
                          now it has the capital too. */}
                      <span className="fact">{r.sessions > 0 ? capAfterNumber(`${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}`) : "Never done"}</span>
                      {r.lastDate && <span className="fact cyan">{capitalize(agoPhraseLower(r.lastDate, todayIso))}</span>}
                      {r.favorite && <span className="fact">Favorite</span>}
                      {r.hidden && <span className="fact">Hidden</span>}
                      {c.archived && <span className="fact">Archived</span>}
                      {justSaved.includes(r.key) && <span className="fact">Saved</span>}
                    </div>
                    <div className="ex-chips">
                      {chips.map((ch, i) => (
                        <button
                          key={ch.label + i}
                          type="button"
                          className={"ex-chip" + (ch.tone === "primary" ? " on" : ch.tone === "secondary" ? " sec" : "")}
                          aria-label={`${ch.label}, edit`}
                          disabled={selecting}
                          onClick={(e) => { e.stopPropagation(); setClassing({ row: r, open: ch.field }); }}
                        >
                          {ch.label}
                        </button>
                      ))}
                      {/* THE ONE NAG, AND ONLY WHEN IT IS TRUE. */}
                      {needsMuscles(c) && (
                        <button type="button" className="ex-chip amber" disabled={selecting}
                          onClick={(e) => { e.stopPropagation(); setClassing({ row: r, open: "muscles" }); }}>
                          Assign Muscles
                        </button>
                      )}
                      {r.aliases && r.aliases.length > 0 && <span className="ex-chip quiet">{`Also ${r.aliases.join(", ")}`}</span>}
                    </div>
                  </div>
                  {selecting
                    ? <span className={"ex-check" + (on ? " on" : "")} aria-hidden="true" />
                    : (
                      <button type="button" className="ex-more" aria-label={`More for ${r.name}`}
                        onClick={(e) => { e.stopPropagation(); setMenu(r); }}>
                        <span aria-hidden="true">···</span>
                      </button>
                    )}
                </div>
              );
            })}
            {shown.length === 0 && (
              <div className="row"><div className="row-grow"><div className="conn-meta">Nothing matches what you are filtering by</div></div></div>
            )}
          </div></div>

          <div className="pad-x"><div className="bp-sub">{floorLine(view, rows.length, filter)}</div></div>
        </>
      )}

      {/* RENAME, its own small sheet: it is the one edit that rewrites every
          record this exercise has, so it does not share a form with the
          classification, which rewrites none of them. */}
      {renaming && createPortal(
        <div className="sheet-scrim" onClick={() => setRenaming(null)}>
          <div className="card xs" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <SheetBar
              title={renaming.name}
              onCancel={() => setRenaming(null)}
              saveLabel="Done"
              onSave={() => {
                const r = renaming;
                setRenaming(null);
                if (draft.trim() && draft.trim() !== r.name) onRename(r, draft);
              }}
            />
            <div className="sheet-form">
              <div className="grp xs-grp"><div className="eyebrow">Name</div></div>
              <div className="pad-x"><div className="card xs-group">
                <div className="row xs-row" onClick={() => renameRef.current?.focus()}>
                  <input ref={renameRef} className="xs-input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Exercise Name" />
                </div>
              </div></div>
              <div className="pad-x"><div className="bp-sub">
                Renaming keeps every session this exercise already has, and the old name stays searchable.
              </div></div>
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
        <ActionSheet title={menu.name} actions={menuActions(menu)} onClose={() => setMenu(null)} />
      )}

      {merging && (
        <PickSheet
          title={"Merge " + merging.name + " Into"}
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

/** "yesterday" is a sentence fragment mid-line and a line's first word on its
 *  own, and this row prints it on its own. */
function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
