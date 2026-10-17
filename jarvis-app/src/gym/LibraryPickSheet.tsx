import { liftTitle } from "../shared/casing";
import { useState } from "react";
import { createPortal } from "react-dom";
import SheetBar from "../shared/SheetBar";
import { newExerciseKey, type LibraryEntry } from "./library";
import { readClassStore, type Classification } from "./classify";
import { adoptStarter, pickerRows, pickerSections, writeAdopted, type PickerRow } from "./libraryView";
import { readGymSettings, writeGymSettings, type CreatedLift } from "./settings";
import { MEASURE_LABEL, type MeasureKind } from "./types";

/**
 * THE EXERCISE LIBRARY, as a picker (catalog §3.5, §3.9). Search-as-you-type
 * over every exercise name ever used. Used by Swap (kindFilter set to the
 * exercise it is replacing, so a substitute always logs the same way), by
 * Add Mid-Session and the empty workout (no kindFilter -- anything in the
 * library is fair game), by a day's Add from Your Exercises (multi) and by a
 * past workout's Add Exercise. Free text still works: nothing in the list
 * matching is not an error state, it is the normal way a brand-new exercise
 * gets its first entry.
 *
 * ONE SOURCE (Dave 2026-10-16, Q): the rows are libraryView.pickerRows, the
 * library's default view (hidden and archived out) with no cap, so every
 * caller of this sheet lists the same exercises the Exercises page does. The
 * preloaded catalog's entries (S9) ride in the same list under the same
 * muscle sections; the athlete's own carry a quiet Yours mark, and picking a
 * starter adopts it as theirs with its muscles set.
 */
export default function LibraryPickSheet({
  title, library, kindFilter, onPick, onPickMany, onFreeText, onAdopt, onCancel,
}: {
  title: string;
  library: LibraryEntry[];
  kindFilter?: MeasureKind;
  onPick: (entry: LibraryEntry) => void;
  /** MANY AT ONCE (Dave, 2026-09-14: "it should be very easy to assign
   *  exercises to workout days"). Building a day used to be Add Exercise,
   *  type, pick the suggestion, Save -- per exercise, four steps and a
   *  keyboard for each of six lifts. With this the sheet becomes a
   *  multi-select: tap the six, Add Them once. Absent keeps the single-pick
   *  behaviour Swap and Add Mid-Session want, where picking two would make
   *  no sense. */
  onPickMany?: (entries: LibraryEntry[]) => void;
  /** Called with the typed text when nothing in the library matches and the
   *  athlete wants to use it anyway. Absent hides that path entirely. */
  onFreeText?: (query: string) => void;
  /** A STARTER BECOMES THE ATHLETE'S (S9). Each picked catalog entry is
   *  adopted before it is handed to onPick or onPickMany: a fresh key, and
   *  the catalog's muscles as its classification. A caller holding in-memory
   *  copies of GymSettings (GymFlow) takes the seeds and classifications
   *  here and writes them through its own setters; without this the sheet
   *  writes GymSettings itself. */
  onAdopt?: (adopted: { entry: LibraryEntry; seed: CreatedLift; cls: Classification }[]) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<LibraryEntry[]>([]);
  const multi = !!onPickMany;
  const isPicked = (k: string) => picked.some((e) => e.key === k);
  const toggle = (entry: LibraryEntry) =>
    setPicked((p) => (p.some((e) => e.key === entry.key) ? p.filter((e) => e.key !== entry.key) : [...p, entry]));
  // UP-ATH-21 (2026-09-06): a lift hidden on Your Lifts is not offered here,
  // and (2026-10-16) neither is one archived on the Exercises page. Read at
  // render, which is cheap and always current: hiding one is a rare tap and
  // the answer must not be stale behind it.
  const gs = readGymSettings();
  const store = readClassStore(gs.classByKey, gs.muscleByKey);
  const rows = pickerRows(library, store, gs.hiddenKeys ?? [], { q, ...(kindFilter ? { kind: kindFilter } : {}) });
  const sections = pickerSections(rows);
  // One head over the whole list says nothing a list does not: heads are
  // drawn only when there are two or more sections to tell apart.
  const headed = sections.length > 1;

  /** The entries as the caller gets them: a starter adopted, an own entry as
   *  it was. The adoptions are written once, as a batch. */
  const resolve = (entries: LibraryEntry[]): LibraryEntry[] => {
    const adopted: { entry: LibraryEntry; seed: CreatedLift; cls: Classification }[] = [];
    const out = entries.map((e) => {
      if (!e.starter) return e;
      const a = adoptStarter(e);
      adopted.push(a);
      return a.entry;
    });
    if (adopted.length) {
      if (onAdopt) onAdopt(adopted);
      else writeAdopted(adopted, readGymSettings, writeGymSettings);
    }
    return out;
  };

  const row = (r: PickerRow) => {
    const entry = r.entry;
    // The kind label is the row's one grey when it shows; Yours is the one
    // grey otherwise (one grey per row, R1). A non-default kind can only be
    // the athlete's own, since every starter logs weight and reps.
    const meta = !kindFilter && entry.kind !== "weight_reps";
    return (
      <div className="row" role="button" tabIndex={0} key={entry.key}
        aria-pressed={multi ? isPicked(entry.key) : undefined}
        onClick={() => (multi ? toggle(entry) : onPick(resolve([entry])[0]!))}>
        <div className="row-grow">
          <div className="conn-name truncate">{liftTitle(entry.name)}</div>
          {/* ONLY WHEN IT IS NEWS (2026-09-16, the polish handoff: "drop
              the repeated Weight x Reps from the add-from-your-lifts
              list"). Nearly every lift in a gym is weight and reps, so
              the line was the same three grey words down the whole
              sheet, and the one row that said Rounds was invisible in
              them. It is silent on the default and speaks for anything
              else -- and silent entirely when a kindFilter is on, where
              by definition every row shares the kind. */}
          {meta && (
            <div className="conn-meta">{MEASURE_LABEL[entry.kind]}</div>
          )}
        </div>
        {/* Part 3 wave 1: a starred lift says so, and leads the list. A
            favourite is not done or on track, so the pill is the neutral
            one: its fill and caps set it apart, never the good green. */}
        {entry.favorite && <span className="pill pill-subdued">Favorite</span>}
        {/* YOURS (S9, 2026-10-16): with the catalog in the same list, the
            athlete's own exercise says so in the trailing slot, the one
            fact a row of this sheet carries; a starter says nothing, which
            is what the catalog is until it is picked. */}
        {!r.starter && !entry.favorite && !meta && <div className="row-value"><span className="fact">Yours</span></div>}
        {multi && <div className={"task-check" + (isPicked(entry.key) ? " done" : "")} />}
      </div>
    );
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {/* THE WAY OUT IS AT THE TOP (2026-09-16, Dave: "the modal doesn't
            scroll. Can't get out of it. Freezes the whole app").

            THE FREEZE: .sheet-scrim > .card is a flex column capped at 92% of
            the visible band, and every child of it declared how it behaves in
            that column except this list, which was a bare <div>. A flex item
            defaults to min-height: auto, so it could not shrink below its own
            content: with two dozen lifts in it the list grew past the cap,
            pushed Add and Cancel off the bottom of the screen, and nothing
            scrolled because nothing had been told it was the scroller. Every
            exit was below the fold.

            Two fixes, because one is not enough: the list is the scroll
            region now (.sheet-list, the rules .sheet-form has always had),
            and Cancel moved to a bar at the top where it cannot be pushed
            anywhere. The count rides the same bar, so what you are about to
            add is visible while you pick instead of only after you scroll. */}
        <SheetBar
          title={title}
          onCancel={onCancel}
          saveLabel={multi ? (picked.length === 0 ? "Add" : `Add ${picked.length}`) : "Done"}
          saveDisabled={multi ? picked.length === 0 : false}
          onSave={() => (multi && picked.length > 0 ? onPickMany!(resolve(picked)) : onCancel())}
        />
        {/* The search field the Exercises page uses, not a bare bordered
            input: same control, same shape, one search bar in the app. */}
        <div className="pad-x ex-search">
          <input
            className="xs-input" type="search" autoFocus placeholder="Search Exercises"
            aria-label="Search Exercises"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="sheet-list">
          {/* GROUPED BY THE MUSCLE IT TRAINS (S9): the catalog's entries and
              the athlete's own under one head per primary muscle, the twelve
              the app counts by, in the app's order; the unsorted last. */}
          {sections.map((sec) => (
            <div key={sec.label}>
              {headed && <div className="grp xs-grp"><div className="eyebrow">{sec.label}</div></div>}
              <div className="list-flat">{sec.rows.map(row)}</div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="pad-x"><div className="bp-sub">Nothing found yet: keep typing, or add it new</div></div>
          )}
        </div>
        {/* The one action the bar cannot carry: it appears only when what was
            typed matches nothing, and it names what it would create. */}
        {onFreeText && q.trim() && (
          <div className="pad-x sheet-actions">
            <button className="btn btn-secondary btn-block" onClick={() => onFreeText(liftTitle(q.trim()))}>
              Use &ldquo;{q.trim()}&rdquo; Anyway
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A fresh exerciseKey for a free-text pick that matched nothing in the
 *  library -- exported so callers (Swap, Add Mid-Session) do not each mint
 *  their own and risk drifting from how the library itself mints one. */
export { newExerciseKey };
