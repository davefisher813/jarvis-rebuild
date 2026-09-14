import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { LibraryRow } from "./libraryEdit";
import { pressable } from "../shared/pressable";
import { agoPhraseLower } from "./summary";
import { PickSheet, type PickItem } from "./ActionSheet";
import SheetBar from "../shared/SheetBar";
import { findDuplicates, pairId, type DuplicatePair } from "./duplicates";
import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "./muscles";

// YOUR LIFTS (UP-ATH-21, 2026-09-06). The exercise library has known every
// lift the athlete has ever used since it shipped, and the only thing that
// ever rendered it was an autocomplete inside a picker. This is the list, as
// a page: what you have, how many sessions each one carries, when you last
// did it, and the two repairs a free-text library needs.
//
// Presentational, like every screen in this folder: rows in, callbacks out.
// The writes live in gym/libraryEdit.ts and are run by GymFlow.
export default function LibraryPage({ rows, todayIso, onOpen, onRename, onMerge, onMergePreview, onToggleHidden, onToggleFavorite, onSetGoal, muscles, onSetMuscles, dismissedDupes, onDismissDuplicate, onBack }: {
  rows: LibraryRow[];
  todayIso: string;
  onOpen: (row: LibraryRow) => void;
  onRename: (row: LibraryRow, name: string) => void;
  /** loser folds into survivor. Only ever offered between lifts that log the
   *  same way: numbers from two different measures cannot share a series. */
  onMerge: (loser: LibraryRow, survivorKey: string) => void;
  onToggleHidden: (row: LibraryRow) => void;
  /** Part 3 wave 1 (2026-09-13): what a merge would reach, for the review
   *  card before it runs. Absent, the merge runs straight from the picker. */
  onMergePreview?: (loser: LibraryRow, survivorKey: string) => { sessions: number; programDays: number };
  /** Part 3 wave 1: star or unstar a lift; starred lifts lead every picker. */
  onToggleFavorite?: (row: LibraryRow) => void;
  /** THE GOAL OPTION, WHERE THE EXERCISE IS (Dave 2026-09-12: "the list of
   *  exercises there's a goal option"). Optional so a caller with no goal
   *  wiring at all (there is none today) still renders this page exactly as
   *  it did before -- the pill is absent with the prop. */
  onSetGoal?: (row: LibraryRow) => void;
  /** MUSCLES PER LIFT (2026-09-14). The tags as they stand, by library key,
   *  and the write that changes them. Primary first. Optional, so a caller
   *  with no muscle wiring renders the page exactly as before. */
  muscles?: Record<string, MuscleGroup[]>;
  onSetMuscles?: (row: LibraryRow, muscles: MuscleGroup[]) => void;
  /** Near-duplicate suggestions: pairs already waved off, and the write that
   *  waves one off. Absent, no duplicate card is offered at all. */
  dismissedDupes?: string[];
  onDismissDuplicate?: (id: string) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<LibraryRow | null>(null);
  const [draft, setDraft] = useState("");
  const [merging, setMerging] = useState<LibraryRow | null>(null);
  const [mergeReview, setMergeReview] = useState<{ loser: LibraryRow; survivor: LibraryRow; sessions: number; programDays: number } | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const shown = rows.filter((r) => showHidden || !r.hidden);
  const hiddenCount = rows.filter((r) => r.hidden).length;
  const openEdit = (r: LibraryRow) => { setEditing(r); setDraft(r.name); };

  // MUSCLES, LIVE WHILE THE SHEET IS OPEN. The tags are a list with the
  // primary first, so tapping the one already marked primary clears it and
  // tapping any other adds it to the end.
  const tagsOf = (r: LibraryRow): MuscleGroup[] => muscles?.[r.key] ?? [];
  const toggleMuscle = (r: LibraryRow, m: MuscleGroup) => {
    if (!onSetMuscles) return;
    const cur = tagsOf(r);
    onSetMuscles(r, cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]);
  };

  // NEAR-DUPLICATES (2026-09-14). Computed from the rows already on screen,
  // so there is nothing to fetch and nothing to keep in sync; the card is
  // simply absent when the library is clean, which is most of the time.
  const dupes: DuplicatePair[] = useMemo(
    () => (onDismissDuplicate ? findDuplicates(rows, dismissedDupes ?? []) : []),
    [rows, dismissedDupes, onDismissDuplicate],
  );

  const mergeItems: PickItem[] = merging
    ? rows
      .filter((r) => r.key !== merging.key && r.kind === merging.kind)
      .map((r) => ({ id: r.key, label: r.name, sub: r.sessions > 0 ? r.sessions + (r.sessions === 1 ? " session" : " sessions") : "Never done" }))
    : [];

  return (
    <div className="screen ruled health-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Your Lifts</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Lifts Yet</div>
          <div className="empty-sub">Every exercise you add to a program or log in a session lands here</div>
        </div>
      ) : (
        <>
          {/* SAME LIFT, TWO NAMES (Dave 2026-09-14). Above the list, because
              a fork is the one thing on this page worth fixing before you
              read anything else -- every number below it is split in two
              until you do. It proposes and never acts: Merge opens the same
              reviewed flow the Edit sheet does, and Not the Same puts the
              pair away for good. */}
          {dupes.length > 0 && (
            <div className="pad-x"><div className="card pad">
              <div className="eyebrow">Same Lift, Two Names?</div>
              {dupes.slice(0, 3).map((d) => (
                <div className="lib-dupe" key={pairId(d.keep.key, d.fold.key)}>
                  <div className="conn-name">{d.fold.name} and {d.keep.name}</div>
                  <div className="bp-sub">
                    {d.why}
                    {d.fold.sessions > 0 ? ` · ${d.fold.sessions} ${d.fold.sessions === 1 ? "session" : "sessions"} would move across` : " · nothing logged under it yet"}
                  </div>
                  <div className="btn-row">
                    <button className="btn btn-secondary" onClick={() => {
                      const survivor = d.keep;
                      if (onMergePreview) setMergeReview({ loser: d.fold, survivor, ...onMergePreview(d.fold, survivor.key) });
                      else onMerge(d.fold, survivor.key);
                    }}>Merge Into {d.keep.name}</button>
                    <button className="btn btn-tertiary" onClick={() => onDismissDuplicate?.(pairId(d.keep.key, d.fold.key))}>Not the Same</button>
                  </div>
                </div>
              ))}
            </div></div>
          )}
          <div className="pad-x"><div className="card list-card-ruled">
            {shown.map((r) => (
              <div className="row" key={r.key} {...pressable(() => onOpen(r))}>
                <div className="row-grow">
                  <div className="conn-name">{r.name}</div>
                  <div className="bp-sub">
                    {r.sessions > 0
                      ? r.sessions + (r.sessions === 1 ? " session" : " sessions")
                      : "Never done"}
                    {r.lastDate ? " · Last " + agoPhraseLower(r.lastDate, todayIso) : ""}
                    {r.hidden ? " · Hidden" : ""}
                  </div>
                  {/* H-23: the names it used to go by, in the reading hue; and
                      the star, as a word, since the star glyph is the Brain's. */}
                  {((r.aliases && r.aliases.length > 0) || r.favorite || tagsOf(r).length > 0) && (
                    <div className="facts">
                      {r.favorite && <span className="pill pill-good">Favorite</span>}
                      {/* The muscles, on the row, so the page answers "what
                          have I actually tagged?" at a glance -- which is the
                          question the weekly volume card silently depends on
                          and never used to show anywhere. */}
                      {tagsOf(r).map((m) => <span className="fact" key={m}>{MUSCLE_LABEL[m]}</span>)}
                      {r.aliases && r.aliases.length > 0 && <span className="fact cyan">{"Also " + r.aliases.join(", ")}</span>}
                    </div>
                  )}
                </div>
                <div className="lib-row-acts">
                  {onSetGoal && <button className="pill-act" onClick={(e) => { e.stopPropagation(); onSetGoal(r); }}>Goal</button>}
                  <button className="pill-act" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>Edit</button>
                </div>
              </div>
            ))}
          </div></div>
          {/* EVERY LIST HAS A FLOOR. */}
          <div className="pad-x"><div className="bp-sub">
            {shown.length === rows.length
              ? "That's every lift you have."
              : "That's every lift you have, except the hidden ones."}
          </div></div>
          {hiddenCount > 0 && (
            <div className="pad-x">
              <button className="btn btn-secondary btn-block" onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? "Hide the Hidden" : "Show Hidden"}
              </button>
            </div>
          )}
        </>
      )}

      {/* EDIT IS A SHEET NOW (Dave, 2026-09-14: "the exercise page edit
          button doesn't work").

          It always worked. It set `editing` and rendered this card INLINE, in
          document order, after the whole list, after the "that's every lift"
          floor and after Show Hidden -- and `.screen` is the scroller, so
          with a real library of dozens of lifts the card opened somewhere
          around 3,000px below the fold. Tapping Edit scrolled nothing and
          moved nothing: from the athlete's chair, a dead button.

          Every other editor in this folder -- ActionSheet, PickSheet,
          LibraryPickSheet, ExerciseSheet -- portals into a scrim over the
          page. This one was the only exception, and there was no reason for
          it to be. Now it is a sheet like the rest, which fixes the merge
          review below by the same stroke: that card was inline and off-screen
          too, so picking a survivor also appeared to do nothing. */}
      {editing && createPortal(
        <div className="sheet-scrim" onClick={() => setEditing(null)}>
          <div className="card xs" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            {/* Save is the bar's, like every other sheet in the app: the
                muscle chips write as they are tapped, so the only thing Save
                has left to commit is the name. */}
            <SheetBar
              title={editing.name}
              onCancel={() => setEditing(null)}
              saveLabel="Done"
              onSave={() => {
                const r = editing;
                setEditing(null);
                if (draft.trim() && draft.trim() !== r.name) onRename(r, draft);
              }}
            />
            <div className="sheet-form">
              <div className="grp xs-grp"><div className="eyebrow">Name</div></div>
              <div className="pad-x"><div className="card xs-group">
                <div className="row xs-row">
                  <input className="xs-input" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Lift Name" />
                </div>
              </div></div>
              <div className="pad-x"><div className="bp-sub">Renaming keeps every session this lift already has.</div></div>

              {/* MUSCLES, WHERE THE LIFT IS. They used to be settable only
                  inside one program day's exercise sheet, one muscle at a
                  time, keyed to nothing -- so the tag vanished on a rename
                  and never existed for a lift logged mid-session. Here they
                  hang off the library key, they are a list, and the first one
                  tapped is the primary. */}
              {onSetMuscles && (
                <>
                  <div className="grp xs-grp"><div className="eyebrow">Muscles</div></div>
                  <div className="pad-x"><div className="card xs-group">
                    <div className="row xs-row">
                      <div className="row-grow">
                        <div className="conn-name">Muscles Worked</div>
                        <div className="conn-meta">
                          {tagsOf(editing).length === 0
                            ? "Untagged lifts are left out of Weekly Volume"
                            : `${MUSCLE_LABEL[tagsOf(editing)[0]!]} first, then the rest at half a set each`}
                        </div>
                      </div>
                    </div>
                    <div className="row xs-row">
                      <div className="chip-row">
                        {MUSCLE_GROUPS.map((m) => {
                          const at = tagsOf(editing).indexOf(m);
                          return (
                            <button
                              key={m}
                              className={"chip" + (at === 0 ? " active" : at > 0 ? " chip-on" : "")}
                              aria-pressed={at >= 0}
                              onClick={() => toggleMuscle(editing, m)}
                            >
                              {MUSCLE_LABEL[m]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div></div>
                </>
              )}

              <div className="grp xs-grp"><div className="eyebrow">This Lift</div></div>
              <div className="pad-x">
                {onToggleFavorite && (
                  <button className="btn btn-secondary btn-block" onClick={() => { const r = editing; setEditing(null); onToggleFavorite(r); }}>
                    {editing.favorite ? "Remove From Favorites" : "Add to Favorites"}
                  </button>
                )}
                <button className="btn btn-secondary btn-block" onClick={() => { setMerging(editing); setEditing(null); }}>Merge Into Another Lift</button>
                <button className="btn btn-secondary btn-block" onClick={() => { const r = editing; setEditing(null); onToggleHidden(r); }}>
                  {editing.hidden ? "Offer It Again" : "Hide From Suggestions"}
                </button>
              </div>
              <div className="xs-foot" />
            </div>
          </div>
        </div>,
        document.body,
      )}

      {merging && (
        <PickSheet
          title={"Merge " + merging.name + " Into"}
          items={mergeItems}
          emptyText="No other lift logs the same way, so there is nothing to merge into."
          onPick={(ids) => {
            const r = merging; setMerging(null);
            if (!ids[0]) return;
            // Part 3 wave 1: a merge is reviewed before it runs. The card says
            // what it reaches; Merge is the one tap that writes.
            const survivor = rows.find((x) => x.key === ids[0]);
            if (onMergePreview && survivor) setMergeReview({ loser: r, survivor, ...onMergePreview(r, ids[0]) });
            else onMerge(r, ids[0]);
          }}
          onCancel={() => setMerging(null)}
        />
      )}

      {/* The review card, portaled for the same reason the editor is: inline
          at the bottom of a long page, it opened below the fold and the
          merge looked like it had silently failed. */}
      {mergeReview && createPortal(
        <div className="sheet-scrim" onClick={() => setMergeReview(null)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="pad-x pad">
          <div className="conn-name">Merge {mergeReview.loser.name} Into {mergeReview.survivor.name}</div>
          <div className="facts">
            <span className="fact">{mergeReview.sessions} {mergeReview.sessions === 1 ? "session" : "sessions"}</span>
            <span className="fact">{mergeReview.programDays} program {mergeReview.programDays === 1 ? "day" : "days"}</span>
          </div>
          <div className="bp-sub">Every one of them will read as {mergeReview.survivor.name}, and {mergeReview.loser.name} stays searchable as its old name. Undo on the receipt puts it all back.</div>
          <button className="btn btn-primary btn-block" onClick={() => { const m = mergeReview; setMergeReview(null); onMerge(m.loser, m.survivor.key); }}>Merge</button>
          <button className="btn btn-secondary btn-block" onClick={() => setMergeReview(null)}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <div className="screen-foot" />
    </div>
  );
}
