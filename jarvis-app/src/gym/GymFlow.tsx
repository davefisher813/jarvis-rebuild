import { NAME_FIELD } from "../shared/nameField";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGym, useOptionalSchedule, useOptionalCategories, useOptionalGoals, useOptionalMetrics } from "../data/NotesProvider";
import { todayISO } from "../tasks/grouping";
import { monthDay, dayPhrase } from "../money/bills";
import { agoPhrase, agoPhraseLower, workoutMinutes } from "./summary";
import { durationOf } from "../insights/analytics";
import { groupForToday, ungroupToday, isLiveGroup } from "./liveGroups";
import { setSessionOpen } from "./sessionChrome";
import { readHealthSettings } from "../health/settings";
import { ENTITY_PROGRAM, ENTITY_WORKOUT, type DayBlock, type Exercise, type Program, type ProgramDay, type ProgramWeek, type Workout, type SetEntry, type WorkoutExercise, type WorkoutData, type MeasureKind } from "./types";
import { useFreshLists } from "../data/useFreshLists";
import { recordSpot } from "../restore/whereYouWere";
import { targetLine, formatSet, planChip, planChipText } from "./measures";
import { applySuggestion, type Suggestion } from "./progression";
import { receiptFor, type Receipt } from "./prs";
import { effectiveKind } from "../categories/kinds";
import type { Goal } from "../life/types";
import { liftMeasureState, trainingMeasureState, type LiftMeasure, type TrainingMeasure } from "./goalMeasures";
import type { MetricDef, MetricLog } from "./metrics";
import LiftDetailScreen from "./LiftDetailScreen";
import LiftGoalSheet from "./LiftGoalSheet";
import { readLive, writeLive, clearLive, logSet, setLoggedSets, skipExercise, swapExercise, addExerciseMidSession, sessionExercisesSameAsLastTime, programExerciseFor, queueFinished, flushPending, hasWork, isStillActive, parkLive, resumeLive, twinWorkout, type LiveSession, elapsedMs } from "./liveSession";
import { bumpStrip, uniformStrip } from "./strip";
import { buildLibrary, newExerciseKey, withAliases, withCreated, withFavorites, type LibraryEntry } from "./library";
import LibraryPickSheet from "./LibraryPickSheet";
import { emit } from "../events";
import { dayWithSessionEntry, movedToDay } from "./edit";
import { defaultUnit, equipmentOf } from "./types";
import { loadFields, loadStyleOf, type LoadStyle } from "./equipment";
import { groupLabels, groupExercises, ungroupExercise, groupOf } from "./groups";
import {
  nextCopyName, duplicateExercise, duplicateDay, duplicateProgramData,
  moveExerciseToDay, copyExerciseToDays, moveDayBetweenPrograms, applyExerciseEdit, duplicateDayFresh,
} from "./edit";
import { pinLabel, todayDow, pinnedTo, nextPinnedDay, WEEKDAY_ABBR, WEEKDAY_FULL } from "./pins";
import { nextDayFor, SCRATCH_DAY_ID, SCRATCH_DAY_NAME } from "./nextDay";
import { muscleMapFrom } from "./insights";
import type { MuscleGroup } from "./muscles";
import { sameLiftAnyKind } from "./identity";
import { estimateDay, type FitPlan, dayUnderPlan } from "./fit";
import { readGymSettings, writeGymSettings, rackFrom, type CreatedLift } from "./settings";
import FitSheet from "./FitSheet";
import ExerciseSheet from "./ExerciseSheet";
import SessionScreen from "./SessionScreen";
import ReceiptSheet from "./ReceiptSheet";
import UploadFlow from "./UploadFlow";
import HistoryScreen from "./HistoryScreen";
import LibraryPage from "./LibraryPage";
import { libraryRows, renameLift, mergeLifts, isEmptyPatch, aliasesAfterRename, aliasesAfterMerge, invertPatch, type LibraryRow, type AliasMap } from "./libraryEdit";
import { classOf, EMPTY_CLASS, isBlank, mergeClass, muscleListOf, needsMuscles, readClassStore, type Chip, type ClassConflict, type ClassStore } from "./classify";
import ClassifySheet from "./ClassifySheet";
import { expectedSignature, patchSignature, planMerge, repointGoal, undoSafe, type MergePlan, type MergeState } from "./merge";
import { MergeReviewSheet } from "./DuplicateReview";
import { pairId } from "./duplicates";
import { mmss } from "./conditioning";
import DurationCard from "./DurationCard";
import ActionSheet, { PickSheet, type SheetAction, type PickItem } from "./ActionSheet";
// The row's one visible menu door, shared with All Data since 2026-09-16.
import RowMenuButton from "../shared/RowMenuButton";
import SetStrip from "./SetStrip";
import ReorderList from "../shared/ReorderList";
import SwipeDelete from "../shared/SwipeDelete";
import { usePushDepth } from "../shared/pushNav";
import { pressable } from "../shared/pressable";
import { useLongPress } from "../shared/useLongPress";
import { showToast } from "../shared/toast";
import { attemptWrite, WRITE_FAILED_MESSAGE } from "../shared/guard";
import { useAI } from "../ai/useAI";
import { capAfterNumber, lineCase, liftTitle, workoutTitle } from "../shared/casing";
import { BarbellGlyph } from "../shared/glyphs";
import { Ellipsis } from "../shared/icons";
import Stepper from "../shared/Stepper";
import { own, rowDoor } from "../shared/rowDoor";

const CHEV = (
  <div className="chev" />
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const DUMBBELL = (
  <BarbellGlyph />
);

// UP-ATH-02: "18:00" as the athlete reads it. The app's own fmtTime lives in
// schedule/, and the gym reaches into schedule for exactly one thing already
// (occursOn, lazily); a five-line clock beats a second static dependency.
function gameClock(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3);
  const h12 = h % 12 || 12;
  return h12 + (m === "00" ? "" : ":" + m) + (h < 12 ? " AM" : " PM");
}

const ACTIVE_PROGRAM_KEY = "jarvis.gym.activeProgram.v1";

let seq = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

function findDay(weeks: ProgramWeek[], dayId: string): ProgramDay | undefined {
  for (const w of weeks) {
    const d = w.days.find((x) => x.id === dayId);
    if (d) return d;
  }
  return undefined;
}

export function readActiveProgramId(): string | null {
  try { return localStorage.getItem(ACTIVE_PROGRAM_KEY); } catch { return null; }
}
function writeActiveProgramId(id: string): void {
  try { localStorage.setItem(ACTIVE_PROGRAM_KEY, id); } catch { /* private mode */ }
}

function NameSheet({ title, initial, placeholder, backOff, season, gameCategory, onSave, onDelete, onCancel }: {
  title: string; initial?: string; placeholder: string;
  backOff?: { value: boolean; onChange: (v: boolean) => void };
  // THE SEASON LINK (catalog §4.7): the program's own in-season/off-season
  // flag, editable right alongside its name. Never a status the program is
  // graded on -- a fact the athlete or coach set on purpose.
  season?: { inSeason: boolean; onChangeInSeason: (v: boolean) => void };
  // The calendar has no built-in idea of "a game" -- the athlete says which
  // one of their own categories means that, explicitly, or the link stays
  // silent rather than guess from an event title.
  gameCategory?: { categories: { id: string; name: string }[]; value: string | undefined; onChange: (id: string | undefined) => void };
  onSave: (v: string) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial ?? "");
  // B12 (2026-08-24): Save appends a program, a week, a day, or an exercise,
  // so a fast double tap appended it twice. Fires once.
  const [busy, setBusy] = useState(false);
  // B10: this sheet deletes whole programs, weeks, and days, and logged
  // workouts keep pointing at the ids inside them, so the history page
  // derives from records this delete orphans. That cannot be undone by
  // recreating with new ids, so it gets an arming confirm instead of an
  // Undo that would be a lie.
  const [armed, setArmed] = useState(false);
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{title}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input className="input" {...NAME_FIELD} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
          </div>
          {backOff && (
            <div className="field">
              <div className="input-label">Load</div>
              <div className="chip-row">
                <div className={"chip" + (!backOff.value ? " active" : "")} role="button" tabIndex={0} aria-pressed={!backOff.value}
                  onClick={() => backOff.onChange(false)}>Normal Week</div>
                {/* Never "deload": a lighter week is a plan, not a status to
                    feel bad about (L1). Never a red chip either -- .chip's
                    active state is the app's neutral selection color. */}
                <div className={"chip" + (backOff.value ? " active" : "")} role="button" tabIndex={0} aria-pressed={backOff.value}
                  onClick={() => backOff.onChange(true)}>Back-Off Week</div>
              </div>
            </div>
          )}
          {season && (
            <div className="field">
              <div className="input-label">Season</div>
              <div className="chip-row">
                <div className={"chip" + (!season.inSeason ? " active" : "")} role="button" tabIndex={0} aria-pressed={!season.inSeason}
                  onClick={() => season.onChangeInSeason(false)}>Off-Season</div>
                <div className={"chip" + (season.inSeason ? " active" : "")} role="button" tabIndex={0} aria-pressed={season.inSeason}
                  onClick={() => season.onChangeInSeason(true)}>In-Season</div>
              </div>
            </div>
          )}
          {season?.inSeason && gameCategory && gameCategory.categories.length > 0 && (
            <div className="field">
              <div className="input-label">Which Calendar Category Is a Game</div>
              <div className="chip-row chip-wrap-row">
                {gameCategory.categories.map((c) => (
                  <div key={c.id} className={"chip" + (gameCategory.value === c.id ? " active" : "")} role="button" tabIndex={0}
                    aria-pressed={gameCategory.value === c.id}
                    onClick={() => gameCategory.onChange(gameCategory.value === c.id ? undefined : c.id)}>
                    {c.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" disabled={busy}
            onClick={() => { if (v.trim()) { setBusy(true); onSave(workoutTitle(v.trim())); } }}>{busy ? "Saving..." : "Save"}</button>
          {onDelete && (
            <button className={"btn btn-block " + (armed ? "btn-danger" : "btn-secondary btn-danger-text")}
              onClick={() => (armed ? onDelete() : setArmed(true))}>
              {armed ? "Tap Again to Delete" : "Delete"}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Duplicate Week -> bump (catalog §4.1). One action: +X lb or +X reps on
 *  every planned set in the new week. */
function BumpSheet({ weekLabel, onSave, onCancel }: {
  weekLabel: string;
  onSave: (bump: { w?: number; r?: number; v?: number; t?: number }, backOff: boolean) => void;
  onCancel: () => void;
}) {
  const [w, setW] = useState(0);
  const [r, setR] = useState(0);
  const [backOff, setBackOff] = useState(false);
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Duplicate {weekLabel} & Bump</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Add to Every Weight</div>
            <div className="card">
              <div className="row">
                <div className="row-grow"><div className="conn-name">Weight</div></div>
                <Stepper value={w} step={5} label="Weight" onChange={setW} />
              </div>
              <div className="row">
                <div className="row-grow"><div className="conn-name">Reps</div></div>
                <Stepper value={r} step={1} label="Reps" onChange={setR} />
              </div>
            </div>
          </div>
          <div className="field">
            <div className="input-label">Load</div>
            <div className="chip-row">
              <div className={"chip" + (!backOff ? " active" : "")} role="button" tabIndex={0} aria-pressed={!backOff} onClick={() => setBackOff(false)}>Normal Week</div>
              <div className={"chip" + (backOff ? " active" : "")} role="button" tabIndex={0} aria-pressed={backOff} onClick={() => setBackOff(true)}>Back-Off Week</div>
            </div>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" onClick={() => onSave({ w, r }, backOff)}>Duplicate & Bump</button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** LOG IT LATER (catalog §3.8): a single date field, capped to today or
 *  earlier -- backdating is for a session that already happened. */
function BackdateSheet({ dayName, onStart, onCancel }: { dayName: string; onStart: (date: string) => void; onCancel: () => void }) {
  const [date, setDate] = useState(todayISO());
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Log a Past {dayName}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Date</div>
            <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" onClick={() => onStart(date || todayISO())}>Start Logging</button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** WHAT THE SESSION ITSELF IS (Dave 2026-09-17: "should be able to fully edit
 *  completed workouts").
 *
 *  A finished workout could have its sets corrected and its end time
 *  corrected, and that was all. Its NAME and its DATE -- the two things the
 *  history list is read by, and the two most likely to be wrong on a session
 *  logged from memory the next morning -- were fixed forever. Same shape as
 *  BackdateSheet above, which is the other place a date is picked for a
 *  session that already happened. */
function WorkoutMetaSheet({ initialName, initialDate, onSave, onCancel }: {
  initialName: string; initialDate: string;
  onSave: (next: { dayName: string; date: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(workoutTitle(initialName));
  const [date, setDate] = useState(initialDate);
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">This Session</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input className="input" {...NAME_FIELD} value={name} aria-label="Session Name" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">Date</div>
            {/* No future date: this is a session that already happened, the
                same rule backdating keeps. */}
            <input className="input" type="date" max={todayISO()} value={date} aria-label="Session Date" onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" disabled={!name.trim()}
            onClick={() => onSave({ dayName: workoutTitle(name.trim()), date: date || initialDate })}>Save</button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// LONG-PRESS = THE WHOLE MENU (catalog §3.12). Each row is its own small
// component so useLongPress's hooks attach to a stable per-row instance --
// calling a hook from inside a plain renderRow callback (invoked directly by
// ReorderList's own render) would attach a variable number of hooks to
// ReorderList itself, which is exactly the bug rules-of-hooks exists to
// catch. Same shape as SetStrip's SetChipRow.
// ROW META IS QUIET SENTENCE CASE (the 2026-08-31 gym reformat; Dave, from
// the 5 Day Program screenshot: "Styling is random and doesn't align").
// Every gym row wrote its second line as an .eyebrow -- 11px SHOUTING CAPS
// -- while the app's primary lists (Tasks rows, Today's rows, the category
// page) write row meta as .conn-meta. One grammar now, across every gym
// surface and the health page's Training card; eyebrows go back to being
// kickers (SET N, sheet titles, card leads).
/**
 * GYM-F-26 (2026-09-05, fork option A). Catalog §3.12 chose long-press as the
 * WHOLE menu and added no fallback, so nothing on a day, exercise or program
 * row hinted that holding it opened anything, and VoiceOver and keyboard users
 * could not reach Duplicate, Move, Copy, Pair, Archive or Restore at all
 * (shared/useLongPress.ts is pointer, touch and contextmenu only). One visible
 * door: the same trailing pill on every row, opening the same ActionSheet.
 * A real button, so Enter and Space are free and the label is announced.
 */
/** YOUR LIFTS, AS A ROW AND NOT A CARD (Dave 2026-09-17: "Your lifts / all
 *  programs breaks the rule of stand alone small pill. Combine them into a
 *  nice clean container that matches other containers in the health
 *  section").
 *
 *  Two one-row cards, half a screen apart, each holding a single navigational
 *  door, is the floating-pill shape this app spent the 2026-08-31 count-pill
 *  wave getting rid of. They are the same KIND of thing -- a door to a list
 *  you keep, with its count on it -- so they belong in one grouped card, which
 *  is the Apple Health language every other shelf on these screens already
 *  speaks. Extracted so the program branch can put it under All Programs and
 *  the no-program branch can still show it on its own. */
function LiftsRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <div {...pressable(onOpen)} className="row">
      <div className="row-grow">
        <div className="conn-name">Your Lifts</div>
      </div>
      {/* A CHIP ON THE ROW, NOT A LINE UNDER IT (Dave 2026-09-18: "your lifts
          subtext should be a chip"; health polish 2026-09-16 before it: "Your
          Lifts: trailing 24 exercises").

          It was a clause explaining what the door leads to, which is what the
          door is for, and it made this row two lines tall while All Programs
          beside it was one. The count is the only thing it ever said, so it
          says it in the trailing slot, in the capsule the ruled skin already
          draws for a small fact on a row. */}
      <span className="ex-chip">{capAfterNumber(count + (count === 1 ? " exercise" : " exercises"))}</span>
      {CHEV}
    </div>
  );
}

function DayRow({ day, onOpen, onPin, onMenu, doneWord, current = false }: { day: ProgramDay; onOpen: () => void; onPin?: () => void; onMenu: () => void;
  /** 2026-09-14 (the reference's "Completed Monday"): the weekday of this
   *  day's last session when it was inside the last week. */
  doneWord?: string | null;
  /** A session on this day is open now. */
  current?: boolean;
}) {
  const hold = useLongPress({ onLongPress: onMenu });
  return (
    <div className="row-grow row-press" role="button" tabIndex={0} onClick={onOpen} {...hold}>
      <div className="row-grow">
        <div className="conn-name truncate">{workoutTitle(day.name)}</div>
        {/* KILL THE GREY SUBTEXT (Dave 2026-09-10). "6 exercises" under every
            day in the same grey turned the one number that distinguishes them
            into wallpaper. (An empty day's "Empty" went on 2026-09-26: see
            below.) */}
      {/* ONE ROW ANATOMY (Dave 2026-09-16, on the Exercises page: "This looks
          good. But it's not consistent throughout. Uniform everything so it
          looks like a real app. Everything should follow rules").

          The rule was already written: .facts is "the row's second line as
          facts, not a sentence" (G3, G6), the CSS draws the middot so no
          string carries one, and K.3 governs the hues. Every other list in
          this app obeys it -- All Data, Insights, the Exercises page he
          approved. The gym invented a second answer for the same job, filled
          .se-chip capsules in a .r-k slot, so two lists a scroll apart said
          the same kind of thing in two different shapes.

          Capsules are not gone; they keep the job they are actually for, on
          the Exercises page (a classification you can tap) and on a card's
          face. What they stop doing is standing in for a row's values. */}
      {/* AN EMPTY DAY SAYS NOTHING (§AK, 2026-09-26). It used to say
          "Empty", a placeholder in the row's one grey; a day with no lifts
          now shows its name alone, and the line appears with the first
          lift or a state worth stating. */}
      {(day.exercises.length > 0 || current || doneWord) && (
        <div className="facts">
          {day.exercises.length > 0 && <span className="fact">{capAfterNumber(`${day.exercises.length} ${day.exercises.length === 1 ? "lift" : "lifts"}`)}</span>}
          {current && <span className="fact st cyan">Live</span>}
          {!current && doneWord && <span className="fact lime">{doneWord}</span>}
        </div>
      )}
      </div>
      {/* PINS, D4: the weekday claim is a FACT on this row, not a verb.
          (2026-09-16, the polish handoff: "Move Pin Days into day options;
          preserve accessible direct access in the day screen Schedule row.")

          Every day carried a red "Pin Days" capsule until it was pinned, so a
          five-day program showed five red verbs down the right edge, each one
          the loudest thing on its row and none of them the thing you came to
          do. It was also a THIRD trailing control beside the menu and the
          chevron, on a row the app's own arity rule gives one.

          Setting a pin was never lost and is not moved here: the row's own
          options already carried "Pin Days..." before this change, and the
          day screen keeps its Schedule row. What survives on the row is the
          claim itself, once made, in the quiet ink a fact wears. */}
      {day.pinDays?.length ? <span className="se-chip se-chip-pin">{pinLabel(day.pinDays)}</span> : null}
      {/* ONE TRAILING CONTROL (2026-09-16, Dave's Push Day 1 screenshot). The
          row wore a menu AND a chevron, which is the arity rule's two, and the
          two say the same thing twice: the row opens on tap like every
          .row-press row in the app, and the chevron is the decoration of that
          while the menu is a real door. The two program rows in this same file
          have carried the menu alone since GYM-F-26; this is the rest of the
          file catching up to them. */}
      <RowMenuButton onMenu={onMenu} what={day.name} />
    </div>
  );
}

/** THE LENGTH, AND WHETHER TO BELIEVE IT (2026-09-16, Dave's Program
 *  screenshot: a recent session reading 382 MIN, stated as flatly as the date
 *  beside it).
 *
 *  A session's end is stamped when Finish is tapped, so one left open -- the
 *  app closed with it live, the phone in a locker, a finish the next morning
 *  -- records the whole wall clock as time trained. DurationCard has said so
 *  since the 2026-09-14 design, and can correct it; analytics.durationOf has
 *  owned the threshold for as long. But the BROWSING rows never asked, so the
 *  number that needed the sheet was the one thing on the row with no way to
 *  know it did.
 *
 *  Nothing is capped or rewritten. The chip says the same number in the ink a
 *  warning wears, with the word on it, and the row it sits in already opens
 *  the sheet that fixes it. */
function minutesFact(w: WorkoutData) {
  const d = durationOf(w);
  // TWO FACTS, NOT ONE STRING WITH A MIDDOT IN IT. components.css: "Adjacent
  // facts are separated by a middle dot the CSS draws, so no string ever
  // carries one." A fact that punctuates itself is a sentence again.
  return d.flagged
    ? <><span className="fact amber" aria-label={`${d.activeMin} minutes recorded, worth reviewing`}>{capAfterNumber(`${d.activeMin} min`)}</span><span className="fact">Worth Reviewing</span></>
    : <span className="fact">{capAfterNumber(`${workoutMinutes(w)} min`)}</span>;
}

function ExerciseRow({ exercise, pairLabel, onOpen, onMenu }: {
  exercise: Exercise;
  pairLabel?: string;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const hold = useLongPress({ onLongPress: onMenu });
  const plan = planChip(exercise);
  return (
    <div className="row-grow row-press" role="button" tabIndex={0} onClick={onOpen} {...hold}>
      <div className="row-grow">
        {/* THE PREVIEW IS THE SPEC (2026-09-01), RECOLOURED BY THE KEY
            (§AM, 2026-09-25): the pairing tag wears Health's violet, the ink
            the key gives a pair; a ramp and a filler share the one neutral
            tag, set apart by fill and caps -- marked facts, not more prose in
            the name. The tag classes say what the tag IS (a pair, a quiet
            tag), never a colour, so the name cannot bring a retired colour
            back. */}
        <div className="conn-name truncate">
          {pairLabel && <span className="xtag xtag-pair">{pairLabel}</span>}
          {liftTitle(exercise.name)}
          {exercise.ramp && <span className="xtag xtag-dim xtag-after">Ramp</span>}
          {exercise.filler && <span className="xtag xtag-dim xtag-after">Filler</span>}
        </div>
        {/* THE PLAN IS THE ROW'S VALUE, NOT A SENTENCE UNDER ITS NAME
            (2026-09-16, Dave's Push Day 1 screenshot: "the titles of exercise,
            it looks the same as what's under it. So it just all blends
            together and you can't read anything. There's no hierarchy").

            He is right by arithmetic: this line was .conn-meta, 15px at the
            body weight in the secondary ink, sitting under a .conn-name that
            was 17px at the SAME weight in white. Two pixels and one step of
            grey apart, so a name and its numbers read as one block of text.
            The title took its weight (jarvis-design-system.css); the numbers
            take the bounded value slot every other list in this app already
            puts its counts in -- the day row, the session list, the recent
            row. A chip has an edge, so the eye lands on the name first and
            finds the number second, which is the order they matter in.

            Rest rides beside it as its own fact rather than a clause glued on
            with a middot, and only when there is one. It is a length with no
            state that cannot be tapped, so it is a white <b> (§AM: caps change
            nothing on digits): the athlete's quoted note below stays the row's
            one grey, and a plain grey rest beside it would be a second (§AK). */}
        {/* THE COUNT LEADS, AND THE NOUN IS QUIET (2026-09-16, Dave asked for
            the sets to start the line, with a faded bold grey for the word).
            The line used to carry two multiplication signs doing two
            different jobs: the first meant three of these, the second meant
            this weight for this many. The first is a word now, in the ink a
            label wears, so the two numbers a person scans for are the two
            things in colour. */}
        <div className="facts">
          <span className="fact cyan" aria-label={planChipText(exercise)}>
            {plan.count}<em className="fw">{plan.noun}</em>{plan.target}
          </span>
          {exercise.restSec ? <span className="fact"><b>{`${mmss(exercise.restSec)} rest`}</b></span> : null}
        </div>
        {/* The athlete's own note echoes on the row, quoted (preview
            anatomy) -- reference, never coaching. */}
        {exercise.note && <div className="row-ghost">&ldquo;{exercise.note}&rdquo;</div>}
      </div>
      {/* One trailing control, same as the day row above. */}
      <RowMenuButton onMenu={onMenu} what={liftTitle(exercise.name)} />
    </div>
  );
}

function ProgramRow({ program, active, onSwitch, onMenu }: { program: Program; active: boolean; onSwitch: () => void; onMenu: () => void }) {
  const hold = useLongPress({ onLongPress: onMenu });
  return (
    <div className="row-grow row-press" role="button" tabIndex={0} onClick={onSwitch} {...hold}>
      <div className="row-grow">
        <div className="conn-name truncate">{workoutTitle(program.data.name)}</div>
        {program.data.archived && !active && <div className="conn-meta">Archived</div>}
      </div>
      {active && <span className="pill pill-good">Active</span>}
      <RowMenuButton onMenu={onMenu} what={program.data.name} />
    </div>
  );
}

type Sheet =
  | { kind: "closed" }
  | { kind: "program"; programId?: string }
  | { kind: "week"; weekId?: string }
  | { kind: "day"; weekId: string; dayId?: string }
  | { kind: "exercise"; weekId: string; dayId: string; exId?: string }
  // FILL A DAY FROM YOUR LIFTS (2026-09-14): the library as a multi-select,
  // so building a day is one pass instead of one full sheet per exercise.
  | { kind: "fillDay"; weekId: string; dayId: string }
  | { kind: "bump"; weekId: string }
  | { kind: "block"; weekId: string; dayId: string; which: "warmUp" | "coolDown" };

type RowMenu =
  | { kind: "day"; weekId: string; day: ProgramDay }
  | { kind: "exercise"; weekId: string; dayId: string; exercise: Exercise }
  | { kind: "program"; program: Program };

type Picker =
  | { kind: "moveExerciseToDay"; weekId: string; dayId: string; exId: string }
  | { kind: "copyExerciseToDays"; weekId: string; dayId: string; exId: string }
  | { kind: "groupWith"; weekId: string; dayId: string; exId: string }
  /** SUPERSET WITH..., from inside a live session (Dave, 2026-09-21, picking
   *  "ask me each time"). The same picker as Group With, and then a choice
   *  the program editor never has to make: this workout only, or every one. */
  /** SUPERSET, FROM THE DAY ITSELF (Dave, 2026-09-21: "There's also no
   *  superset buttons anywhere in the workout pages"). He was right, and the
   *  reason is that the only way in was a LONG-PRESS menu item called "Group
   *  With..." -- a hidden gesture, under a word he does not use. This is the
   *  visible one, beside Reorder, and it needs no anchor exercise because it
   *  starts from the day: pick two or more, they are a superset. */
  | { kind: "supersetDay"; weekId: string; dayId: string }
  | { kind: "moveDayProgram"; weekId: string; day: ProgramDay }
  | { kind: "moveDayWeek"; targetProgramId: string; day: ProgramDay }
  | { kind: "pinDays"; weekId: string; day: ProgramDay };

/** THE BLOCKS, read view (D3-C). Renders nothing but its own door when a day
 *  has none: an empty block is not a zero to display, it is a day that has
 *  not been given one. */
function BlockList({ title, blocks, minutes, onEdit, tone = "warm" }: {
  /** Warm-up is the amber prep wash; cool-down is blue, fading out (Dave
   *  2026-09-13: "that should not be a warm color... a blue that fades out"). */
  tone?: "warm" | "cool";
  title: string;
  blocks?: DayBlock[];
  minutes?: number;
  onEdit: () => void;
}) {
  const has = !!blocks?.length;
  return (
    // THE PREVIEW IS THE SPEC (2026-09-01): warm-up and cool-down wear the
    // amber prep wash, the kicker carries the minutes ("WARM-UP · 8 MIN"),
    // and each item states its amount at the row's far right -- the exact
    // preview anatomy. Empty stays legal: no items means the card is just
    // its door.
    // THE WASH STAYS (Dave, 2026-09-16: "keep the warm up and cool down
    // colors"). The polish handoff's rule 1 asked for a compact neutral card
    // here, and it was tried: the fill came off and the hue lived on the
    // eyebrow alone. He looked at it and said no. The handoff is a proposal;
    // he is the one reading this page in a gym, and his 2026-09-13 ruling --
    // warm-up warm, cool-down "a blue that fades out" -- was about the card
    // and not only the label. Both come back.
    //
    // What the same rule bought elsewhere is untouched: the Up Next launch
    // card, which really was the brightest rectangle on a black page and had
    // a red Start inside it, stays plain.
    <div className="pad-x"><div className={"card list-card-ruled" + (has ? (tone === "cool" ? " banner-cool" : " banner-warn") : "")}>
      {/* The header row opens the block editor, same as its action (Dave
          2026-09-15: "I want all rows clickable"). */}
      <div className="row" {...rowDoor(onEdit)}>
        <div className="row-grow">
          <div className={"eyebrow" + (has ? (tone === "cool" ? " eyebrow-cool" : " eyebrow-warn") : "")}>{title}{(minutes ?? 0) > 0 ? ` · ${minutes} Min` : ""}</div>
        </div>
        {/* A text action, not a capsule: it opens an editor, it does not act
            on the row (polish rule 2). */}
        <button className="see-all" onClick={own(onEdit)}>{has ? "Edit" : "Add"}</button>
      </div>
      {blocks?.map((b) => (
        <div className="row" key={b.id}>
          <div className="row-grow">
            <div className="conn-name">{b.name}</div>
          </div>
          {b.amount && <div className="conn-meta">{b.amount}</div>}
        </div>
      ))}
    </div></div>
  );
}

/** THE BLOCK EDITOR (D3-C). Free text on purpose: a warm-up is not a
 *  measured lift, so "Bike, easy" and "2 x 15" are the whole model. */
function BlockSheet({ title, blocks, minutes, onSave, onCancel }: {
  title: string;
  blocks: DayBlock[];
  minutes: number;
  onSave: (blocks: DayBlock[], minutes: number) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<DayBlock[]>(blocks.length ? blocks : [{ id: nid("b"), name: "" }]);
  const [mins, setMins] = useState(minutes);
  const patch = (id: string, p: Partial<DayBlock>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{title}</div></div>
        <div className="pad-x sheet-form">
          {rows.map((b, i) => (
            <div className="field" key={b.id}>
              <div className="input-label">{`Item ${i + 1}`}</div>
              <input className="input" placeholder="e.g. Bike, easy" value={b.name}
                onChange={(e) => patch(b.id, { name: e.target.value })} />
              <input className="input" placeholder="e.g. 5 min, 2 x 15" value={b.amount ?? ""}
                onChange={(e) => patch(b.id, { amount: e.target.value })} />
            </div>
          ))}
          <button className="row-create" onClick={() => setRows((r) => [...r, { id: nid("b"), name: "" }])}>Add Another</button>
          <div className="field">
            <div className="input-label">Minutes</div>
            <div className="row">
              <div className="row-grow">
                <div className="conn-name">{mins > 0 ? `${mins} min` : "Not counted"}</div>
                <div className="conn-meta">Counted toward the session estimate</div>
              </div>
              <Stepper value={mins} step={1} min={0} label="Minutes" onChange={setMins} />
            </div>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block"
            onClick={() => onSave(rows.filter((r) => r.name.trim()).map((r) => ({ ...r, name: r.name.trim(), ...(r.amount?.trim() ? { amount: r.amount.trim() } : {}) })), mins)}>
            Save
          </button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The gym track: programs in the user's own words, weeks as the time axis,
// the set strip as the same object in the plan and in the live session, the
// in-gym loop, live PRs, and an honest receipt.
export default function GymFlow({ onBack, door, startDayId, startDoorEventId, startBudgetMin, areaId, startLibrary, startLift, startHistory, startWorkoutId, onRateSession, onLogSoreSpot }: {
  /** 2026-09-14: open straight onto Your Lifts. The Health page's coverage
   *  card names untagged lifts and has to be able to hand you the screen
   *  that fixes them, rather than describing where it is. */
  startLibrary?: boolean;
  /** The approved Health design (2026-09-14): a finding opens the records
   *  behind it. A lift's page, History on a segment, or one saved session. */
  startLift?: { name: string; exerciseKey?: string; kind: MeasureKind; unit?: string; timeUnit?: string };
  startHistory?: "lifts" | "sessions";
  startWorkoutId?: string;
  onBack: () => void;
  /** WORKOUT LOGGING BELONGS WITH THE WORKOUT (Dave 2026-09-10: "how hard it
   *  was, where it hurts, anything related to an actual workout should go
   *  where people are logging their workout data"). The area page owns the
   *  HealthService screens; the gym owns the moments they belong to. Absent
   *  when the gym is mounted somewhere with no health module, and the rows
   *  are absent with them. */
  onRateSession?: () => void;
  onLogSoreSpot?: () => void;
  /** UP-PLAT-26 (2026-09-06): the area this gym lives under, so starting a
   *  session can record a Where You Were spot that actually leads back here.
   *  The restore door (shell/AppShell.tsx) opens a Brain AREA and then the
   *  gym inside it, so a spot with no area id could not be restored, and a
   *  spot that cannot be restored is not recorded. */
  areaId?: string;
  /** D4-C: this mount came through a calendar gym block. The session that
   *  starts here carries the event id so finishing can stamp the block done
   *  with the real minutes, and the block's own length pre-fills the fit
   *  sheet's budget. */
  door?: { eventId: string; budgetMin?: number };
  /** THE HEALTH PAGE'S START (2026-09-02): the hero's Start pill names the
   *  day it showed, and the gym walks into that day's fit sheet on mount,
   *  exactly as tapping Start on the program page would. */
  startDayId?: string;
  /** B5 (2026-09-04): this path skipped the door entirely, so a session
   *  started from the Health hero never carried an event id -- finishing it
   *  had nothing to stamp, and the calendar's gym block sat offering Start
   *  on a session already logged. CategoryDetail.tsx already reads today's
   *  gym block for the hero's own display; this is the same event's id. */
  startDoorEventId?: string;
  /** 2026-09-14: the Health page's Have Less Time? pick. The fit sheet
   *  opens already priced to it; the athlete still says Start. */
  startBudgetMin?: number;
}) {
  const svc = useGym();
  const ai = useAI();
  const schedule = useOptionalSchedule();
  const categoriesSvc = useOptionalCategories();
  const goalsSvc = useOptionalGoals();
  const metricsSvc = useOptionalMetrics();
  // H-40 (Health Push C, 2026-09-12): the rest notification and Celebrations
  // live in Health Settings (health/settings.ts), read off the store when the
  // gym mounts. UP-ATH-03's rule stands: RestTimer stays a countdown with
  // props in and no services. The Notifications page's rest switch writes the
  // same key, so the two switches never disagree.
  const restNotify = readHealthSettings().restNotify;
  const celebrations = readHealthSettings().celebrations;
  const [programs, setPrograms] = useState<Program[]>([]);
  const [allPrograms, setAllPrograms] = useState<Program[]>([]); // active + archived
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [activeProgramId, setActiveProgramId] = useState<string | null>(() => readActiveProgramId());
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);
  const [openDayId, setOpenDayId] = useState<string | null>(null);
  // REORDER IS A MODE (Health Preview, approved 2026-08-31): the grips come
  // out when the Reorder head pill asks for them and step away when it says
  // Done, so a resting row is a name, a fact and one door.
  const [reorderTarget, setReorderTarget] = useState<"days" | "exercises" | null>(null);
  // Seed from storage (2026-08-09): an in-progress session used to be
  // invisible until startDay silently overwrote it. Same-day sessions resume
  // right where they were; an older one with real work is SAVED as a partial
  // workout on mount (a logged set is never lost), and an empty one clears.
  // LOG IT LATER (catalog §3.8): a backdated session is not "stale" just
  // because its date is not today, so it is kept on the same terms.
  // SESSIONS RESUME, NOT FRAGMENT (2026-08-30): isStillActive also keeps a
  // session whose date rolled past midnight while it was genuinely still
  // being logged -- see its doc comment in liveSession.ts.
  const [live, setLive] = useState<LiveSession | null>(() => {
    const s = readLive();
    if (!s || !isStillActive(s, todayISO())) return null;
    // H-52: a session parked when the app was killed resumes on launch,
    // and the parked stretch is folded away so its clock does not run on.
    const back = resumeLive(s);
    if (back !== s) writeLive(back);
    return back;
  });
  // The freshest session, updated synchronously by `update` below so two
  // writes in one event handler compose (see patchLive).
  const liveRef = useRef<LiveSession | null>(live);
  liveRef.current = live;
  // GYM-F-14 (2026-09-05): Back PARKS a session, it does not end it, and
  // `reload` is also the resume path (it reads the live session straight back
  // off storage at :554). So every data refresh -- saving an exercise
  // mid-session, deleting a workout from Recent, reordering days, pinning one
  // -- shoved the athlete back into the session they had just stepped out of
  // to make that very edit. A parked session stays parked until Resume, and
  // says where it is with a row on the program page rather than sitting
  // invisible in storage.
  const [parkedLive, setParkedLive] = useState<LiveSession | null>(null);
  const parkedRef = useRef(false);
  /** Open (or close out) a session: whatever happens next, it is not parked. */
  const enterSession = (s: LiveSession | null) => {
    parkedRef.current = false;
    setParkedLive(null);
    // H-52: coming back from parked folds the parked stretch into pausedMs,
    // so the clock and the receipt count gym time only.
    const back = s && s.pausedAt ? resumeLive(s) : s;
    if (back && back !== s) writeLive(back);
    setLive(back);
  };
  const parkSession = () => {
    const s = readLive();
    const parked = s ? parkLive(s) : null;
    if (parked && parked !== s) writeLive(parked);
    parkedRef.current = !!parked;
    setParkedLive(parked);
    setLive(null);
    // H-27: land where the way back is. The day page's only door is Start,
    // which does resume, but the program page carries the Resume row that
    // says a session is waiting; Health's hero says it too (Push C).
    setOpenDayId(null);
    if (parked) showToast({ message: "Paused · Resume from Health" });
  };
  const [loaded, setLoaded] = useState(false);
  // H-11 / R8 (Health Push B, 2026-09-12): while a session is on screen the
  // shell hides its tab bar and dock and the Log bar owns the bottom edge.
  useEffect(() => { setSessionOpen(!!live); }, [live]);
  useEffect(() => () => setSessionOpen(false), []);
  // D5: the fit sheet between the tap and the session. Holds the day plus
  // any door context until the athlete says Start.
  const [fitFor, setFitFor] = useState<{ day: ProgramDay; doorEventId?: string; budgetMin?: number } | null>(null);
  // D4-C "No pin set, it asks once": the one-time day picker for a door tap
  // on a day no program day is pinned to.
  const [doorPick, setDoorPick] = useState(false);
  const [doorHandled, setDoorHandled] = useState(false);
  const [receipt, setReceipt] = useState<{ receipt: Receipt; dayName: string } | null>(null);
  // Part 3 wave 4 (Dave 13a): the live session never leaves this phone, so
  // the one collision two devices can have is finishing the same day twice.
  // A saved workout for this day and date from elsewhere is said out loud
  // before the receipt; he keeps both or drops this copy.
  const [dupFinish, setDupFinish] = useState<{ twin: Workout } | null>(null);
  // 2026-09-14 (the reference's Adjust time): a budget picked mid-session.
  const [adjustOpen, setAdjustOpen] = useState(false);
  // H-30: the finish waits on the receipt (see finish below).
  const finishing = useRef<{ data: WorkoutData; door: { id: string; date: string } | null } | null>(null);
  const [viewWorkout, setViewWorkout] = useState<Workout | null>(null);
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutExercise[] | null>(null);
  // FULLY EDITABLE (Dave 2026-09-17). The finished session's own name and
  // date, one exercise's overflow menu, its rename, and the door to adding a
  // lift somebody forgot to log. All four were missing.
  const [workoutMetaOpen, setWorkoutMetaOpen] = useState(false);
  const [workoutExMenu, setWorkoutExMenu] = useState<number | null>(null);
  const [workoutExRename, setWorkoutExRename] = useState<number | null>(null);
  const [workoutAddOpen, setWorkoutAddOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [uploadOpen, setUploadOpen] = useState(false);
  // MANAGE (2026-09-16, the polish handoff: "Move Upload a Program and Add a
  // Week into Manage"; Dave's Program screenshot, a stack of red-text rows at
  // the foot of the page). The Days card's create slot is for the thing the
  // list is made of -- a day -- and it had grown two rows that create
  // something else entirely: a whole program, and a week. Three red verbs down
  // one card, and the one the athlete came for was first only by luck. Add Day
  // keeps the slot; the other two are behind one head action.
  const [manageOpen, setManageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(!!startHistory);
  // UP-ATH-21 (2026-09-06): Your Lifts. `hiddenKeys` is read into state so a
  // hide shows immediately; the store is still the source of truth.
  const [libraryOpen, setLibraryOpen] = useState(!!startLibrary);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>(() => readGymSettings().hiddenKeys ?? []);
  // Health Push E (H-23): the old names, by key, read once and written on
  // every rename and merge (libraryEdit.ts owns the two moves).
  const [aliasMap, setAliasMap] = useState<AliasMap>(() => readGymSettings().aliases ?? {});
  const saveAliases = (next: AliasMap) => { setAliasMap(next); writeGymSettings({ ...readGymSettings(), aliases: next }); };
  // Part 3 wave 1 (2026-09-13): the starred lifts, read once, written on
  // every toggle; they lead every picker (library.ts searchLibrary).
  const [favoriteKeys, setFavoriteKeys] = useState<string[]>(() => readGymSettings().favoriteKeys ?? []);
  // 2026-09-14: the per-lift muscle tags, and the near-duplicate pairs waved
  // off. Both live in gym settings beside the hidden and favorite key lists,
  // for the same reason those do: they are facts about the LIBRARY, which is
  // derived at read time and has no document of its own to hang them on.
  const [muscleByKey, setMuscleByKey] = useState<Record<string, MuscleGroup[]>>(
    () => (readGymSettings().muscleByKey ?? {}) as Record<string, MuscleGroup[]>,
  );
  const [dismissedDupes, setDismissedDupes] = useState<string[]>(() => readGymSettings().dismissedDupes ?? []);
  // CREATED BY HAND (Dave 2026-09-17: "I should be able to create exercises
  // here"). Seeds for the derived library; see settings.createdLifts and
  // library.withCreated. Same read-once, write-on-change shape as the lists
  // above it, for the same reason: they are facts about a library that has no
  // document of its own to hang them on.
  const [createdLifts, setCreatedLifts] = useState<CreatedLift[]>(() => readGymSettings().createdLifts ?? []);
  const saveCreatedLifts = (next: CreatedLift[]) => { setCreatedLifts(next); writeGymSettings({ ...readGymSettings(), createdLifts: next }); };
  /** PUT IT IN THE LIBRARY NOW (Dave 2026-09-17: a lift added mid-workout
   *  "doesn't add to my exercise list").
   *
   *  buildLibrary derives from programs and finished workouts, so a lift
   *  added to a session in progress was in neither: you could not classify
   *  it, set a goal on it, or even see it, until the workout was saved --
   *  and not at all if the session was abandoned. A seed costs nothing and
   *  withCreated drops it the moment a real sighting of the same name at the
   *  same measurement exists, so this never doubles a row. */
  const seedLibrary = (draft: { name: string; kind: MeasureKind; unit?: string; exerciseKey?: string }) => {
    const name = draft.name.trim();
    if (!name) return;
    const known = library.some((e) => e.name.trim().toLowerCase() === name.toLowerCase() && e.kind === draft.kind)
      || createdLifts.some((c) => c.name.trim().toLowerCase() === name.toLowerCase() && c.kind === draft.kind);
    if (known) return;
    saveCreatedLifts([...createdLifts, { key: draft.exerciseKey ?? newExerciseKey(), name, kind: draft.kind, ...(draft.unit ? { unit: draft.unit } : {}) }]);
  };
  // WHAT EACH EXERCISE IS (2026-09-14, second pass). The whole classification
  // by library key, read once through classify.readClassStore -- which also
  // carries the older flat muscleByKey forward, so nothing set this morning
  // is lost by opening the page this afternoon.
  const [classStore, setClassStore] = useState<ClassStore>(
    () => { const s = readGymSettings(); return readClassStore(s.classByKey, s.muscleByKey); },
  );
  /** ONE WRITE FOR A CLASSIFICATION, and it writes BOTH stores: the new
   *  shape, and the old flat muscle list it replaces. A build that predates
   *  classByKey still reads muscleByKey, and a reader losing its data because
   *  a newer writer stopped feeding it is the silent kind of loss acceptance
   *  criterion 15 is about. */
  const saveClassStore = (next: ClassStore) => {
    setClassStore(next);
    const muscles: Record<string, string[]> = {};
    for (const [k, c] of Object.entries(next)) {
      const list = muscleListOf(c);
      if (list.length) muscles[k] = list;
    }
    setMuscleByKey(muscles as Record<string, MuscleGroup[]>);
    writeGymSettings({ ...readGymSettings(), classByKey: next, muscleByKey: muscles });
  };
  // THE MERGE, AS A STATE MACHINE (gym/merge.ts). Held here rather than in
  // the page because the write lives here: the sheet may not enter `merged`
  // on its own, and `pending` has to be true for exactly as long as the
  // writes are in flight.
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  /** The shared classification editor, opened from the exercise page. */
  const [classOpen, setClassOpen] = useState<{ row: LibraryRow; open: Chip["field"] } | null>(null);
  /** THE RECORDS AS THEY STAND RIGHT NOW, for anything that has to read them
   *  from inside a callback that outlives its render -- the merge's Undo,
   *  which fires from a toast minutes later and must not judge safety from a
   *  snapshot taken before its own write. */
  const recordsRef = useRef<{ workouts: Workout[]; programs: Program[] }>({ workouts: [], programs: [] });
  // The History segment lives here so a workout opened under Sessions comes
  // back to Sessions (Dave's 18a, 2026-09-13).
  const [historyMode, setHistoryMode] = useState<"lifts" | "sessions">(startHistory ?? "lifts");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  // THE "JUST THIS WORKOUT / EVERY PUSH DAY" CHOICE SHEET WENT (2026-09-26):
  // a superset made in a session is for the session, and the program write is
  // its own explicit line in the session's More sheet.
  const [backdateDay, setBackdateDay] = useState<ProgramDay | null>(null);
  // UP-ATH-02 (2026-09-06): the start time rides along now, so the fact can
  // be stated the way an athlete says it ("Game Saturday 6 PM") instead of as
  // a bare date on the program row and nowhere else.
  const [nextGame, setNextGame] = useState<{ date: string; start?: string } | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  // D12: which of the athlete's own categories mean "Health" (Architecture
  // C tag route) -- a gym goal tags these, silently, so it surfaces in
  // Bigger Picture under Health with zero new grouping UI (catalog build
  // notes). D9/D11: goals and metrics for the lift detail screen.
  const [healthCategoryIds, setHealthCategoryIds] = useState<string[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [metricDefs, setMetricDefs] = useState<MetricDef[]>([]);
  const [metricLogs, setMetricLogs] = useState<MetricLog[]>([]);
  const [liftDetailFor, setLiftDetailFor] = useState<{ name: string; exerciseKey?: string; kind: MeasureKind; unit?: string; timeUnit?: string } | null>(startLift ?? null);
  const [liftGoalSheetOpen, setLiftGoalSheetOpen] = useState(false);
  // The week sheet's "Normal / Back-Off" choice, held at the top level so it
  // is one plain useState called unconditionally on every render -- NOT
  // inside sheetEl(), which is called from different branches depending on
  // what is open and would otherwise call a hook a different number of times
  // between renders (react-hooks/rules-of-hooks is a build gate here).
  const [weekBackOffDraft, setWeekBackOffDraft] = useState(false);
  const [programSeasonDraft, setProgramSeasonDraft] = useState(false);
  const [programGameCategoryDraft, setProgramGameCategoryDraft] = useState<string | undefined>(undefined);

  const program = (activeProgramId ? programs.find((p) => p.id === activeProgramId) : undefined) ?? programs[0] ?? null;
  const weeks = program?.data.weeks ?? [];
  const multiWeek = weeks.length > 1;
  const activeWeek = multiWeek ? (weeks.find((w) => w.id === openWeekId) ?? null) : (weeks[0] ?? null);
  const openWeekSheet = (weekId?: string) => {
    const w = weekId ? weeks.find((x) => x.id === weekId) : undefined;
    setWeekBackOffDraft(w?.backOff ?? false);
    setSheet({ kind: "week", weekId });
  };
  // `edit` present -> that program's own sheet; absent -> always a NEW
  // program, even when one is already active. (Without the explicit `edit`,
  // "Add Program" from the switcher would silently resolve to the active
  // program and edit it instead of creating a second one.)
  const openProgramSheet = (edit?: Program) => {
    setProgramSeasonDraft(!!edit?.data.inSeason);
    setProgramGameCategoryDraft(edit?.data.gameCategoryId);
    setSheet({ kind: "program", programId: edit?.id });
  };

  // THE EXERCISE LIBRARY (catalog §3.5): every exercise ever used, across
  // every program (archived ones included -- real history) and every
  // workout, recomputed only when the underlying data actually changes.
  recordsRef.current = { workouts, programs: allPrograms };
  const library = useMemo(
    () => withFavorites(withAliases(withCreated(buildLibrary(allPrograms, workouts), createdLifts), aliasMap), favoriteKeys),
    [allPrograms, workouts, aliasMap, favoriteKeys, createdLifts],
  );

  // UP-ATH-02 (2026-09-06), THE SEASON LINK's other half. The program row has
  // said "Next Game: Sep 12" since the link shipped, and the two screens an
  // athlete is actually looking at while they train said nothing. One fact,
  // stated once on each: never a taper, never a deload, never advice about
  // what to do with it. Undefined when the program is not in season or the
  // athlete has not said which category means a game, which is the same
  // silence the program row keeps.
  const gameLine = nextGame
    ? "Game " + dayPhrase(nextGame.date, todayISO()) + (nextGame.start ? " " + gameClock(nextGame.start) : "")
    : undefined;

  const reload = useCallback(async () => {
    // Anything logged offline lands as soon as a write succeeds.
    await flushPending((w) => svc.saveWorkout(w));
    const [all, ws] = await Promise.all([svc.listPrograms(true), svc.listWorkouts()]);
    setAllPrograms(all);
    setPrograms(all.filter((p) => !p.data.archived));
    setWorkouts(ws);
    // GYM-F-14: a parked session is not resumed by a refresh.
    if (!parkedRef.current) setLive(readLive());
    setLoaded(true);
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);
  // UP-PLAT-06 (2026-09-06): a workout logged on another device repaints here.
  useFreshLists([ENTITY_PROGRAM, ENTITY_WORKOUT], reload);

  // THE SEASON LINK (catalog §4.7): a real calendar read, gated on the
  // athlete having actually said which category means "a game" -- the
  // calendar has no built-in idea of that, so this never guesses. Looks at
  // the next 7 days only; a game further out is not yet worth surfacing.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!schedule || !program?.data.inSeason || !program.data.gameCategoryId) { setNextGame(null); return; }
      const items = await schedule.listEvents();
      const catId = program.data.gameCategoryId;
      const { occursOn } = await import("../schedule/calendar");
      const today = todayISO();
      let found: { date: string; start?: string } | null = null;
      for (let i = 0; i <= 7; i++) {
        const d = new Date(today + "T00:00:00");
        d.setDate(d.getDate() + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const hit = items.find((e) => e.data.category === catId && occursOn(e.data, iso));
        if (hit) { found = { date: iso, ...(hit.data.start ? { start: hit.data.start } : {}) }; break; }
      }
      if (!cancelled) setNextGame(found);
    })();
    return () => { cancelled = true; };
  }, [schedule, program?.data.inSeason, program?.data.gameCategoryId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!categoriesSvc) return;
      const list = await categoriesSvc.list();
      if (cancelled) return;
      setCategories(list.map((c) => ({ id: c.id, name: c.data.name })));
      setHealthCategoryIds(list.filter((c) => effectiveKind(c.data) === "health").map((c) => c.id));
    })();
    return () => { cancelled = true; };
  }, [categoriesSvc]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!goalsSvc) return;
      const list = await goalsSvc.list();
      if (!cancelled) setGoals(list);
    })();
    return () => { cancelled = true; };
  }, [goalsSvc, receipt]); // reload after a session finishes, so a fresh Achieved shows up

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!metricsSvc) return;
      const [d, l] = await Promise.all([metricsSvc.listDefs(), metricsSvc.listLogs()]);
      if (!cancelled) { setMetricDefs(d); setMetricLogs(l); }
    })();
    return () => { cancelled = true; };
  }, [metricsSvc]);

  usePushDepth(
    live
      ? (openDayId ? (multiWeek ? 3 : 2) : 1)
      : openDayId
        ? (multiWeek ? 2 : 1)
        : (historyOpen || libraryOpen) && liftDetailFor
          ? 2
          : (multiWeek && openWeekId) || historyOpen || libraryOpen || uploadOpen || liftDetailFor
            ? 1
            : 0,
  );

  const switchProgram = (id: string) => {
    setActiveProgramId(id);
    writeActiveProgramId(id);
    setOpenWeekId(null);
    setOpenDayId(null);
    setSwitcherOpen(false);
  };

  // Upload (gym session 2): photo/screenshot or pasted text -> review -> save.
  // Gated on AI availability like every AI-dependent offer.
  // GYM-F-17 (2026-09-05, fork option A): this used to MERGE an upload into
  // the active program, taking its name along with it. With "5 Day Program"
  // active, uploading a coach's "Summer Speed" sheet renamed the athlete's own
  // program, appended a second week, flipped the page to the multi-week layout
  // and made the Up Next card disappear, with no confirm and no undo, over a
  // toast that just said "Program saved". The button says a PROGRAM, so it
  // makes one: the athlete's own plan is never touched, and the toast offers
  // the switch instead of performing it.
  const saveUploaded = async (p: { name: string; weeks: Program["data"]["weeks"] }) => {
    setUploadOpen(false);
    let newId: string | null = null;
    const ok = await attemptWrite(async () => {
      newId = await svc.createProgram({ name: p.name, weeks: p.weeks });
      if (!newId) throw new Error("program not created");
    });
    await reload();
    if (!ok) return;
    const created: string | null = newId;
    showToast({
      message: `${p.name} saved · Check days once`,
      ...(created && created !== activeProgramId
        ? { actionLabel: "Switch to It", onAction: () => switchProgram(created) }
        : {}),
    });
  };

  // GYM-F-18 (2026-09-05): every program edit awaited the store with no
  // catch, and every sheet closed itself BEFORE the write. So a 5xx, an auth
  // hiccup or a dropped socket while online showed nothing at all: no toast,
  // no reload, the list still on the old plan. It read as "I tapped Save and
  // it ignored me." One guarded door now: attemptWrite renders the app's
  // standard failure toast, the reload runs either way so the screen shows
  // what the store actually holds, and the caller gets false so it never
  // announces a save that did not happen. Same shape as today/TodayFlow.tsx.
  const saveWeeks = async (nextWeeks: ProgramWeek[]): Promise<boolean> => {
    if (!program) return false;
    const ok = await attemptWrite(async () => {
      // updateProgram resolves false when the item is gone rather than
      // throwing, and a write that did not land is a failure either way.
      if (!(await svc.updateProgram(program.id, { weeks: nextWeeks }))) throw new Error("program is gone");
    });
    await reload();
    return ok;
  };
  const saveDays = async (weekId: string, days: ProgramDay[]): Promise<boolean> => {
    if (!program) return false;
    return saveWeeks(program.data.weeks.map((w) => (w.id === weekId ? { ...w, days } : w)));
  };

  // THE SWIPE'S OWN DELETES (Dave 2026-09-10: "It's way too hard to delete
  // stuff especially"). A swipe is already a deliberate gesture, so it does
  // not stack a confirmation on top of itself; it hands back an Undo instead,
  // which is the pattern every other list in this app uses and the one that
  // survives a mis-swipe between sets. The day comes back in its own place
  // and the workout under its own id, so nothing that pointed at either is
  // orphaned by the round trip.
  const removeDayNow = async (weekId: string, dayId: string) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    const kept = week?.days.find((d) => d.id === dayId);
    if (!week || !kept) return;
    // The whole pre-delete list is the snapshot, so Undo restores the day in
    // the position it was in rather than at the end of the week.
    const before = week.days;
    if (openDayId === dayId) setOpenDayId(null);
    const ok = await saveDays(weekId, before.filter((d) => d.id !== dayId));
    if (!ok) return;
    showToast({
      message: kept.name + " deleted",
      actionLabel: "Undo",
      onAction: () => void saveDays(weekId, before),
    });
  };
  const removeWorkoutNow = async (id: string, name: string) => {
    const kept = workouts.find((w) => w.id === id);
    if (!kept) return;
    // Guarded like every other write in this file: a delete that failed
    // offline must say so rather than letting the row reappear with no
    // explanation on the next reload.
    const ok = await attemptWrite(() => svc.removeWorkout(id));
    await reload();
    if (!ok) return;
    showToast({
      message: name + " deleted",
      actionLabel: "Undo",
      // A workout is derived-from, never pointed-at, so coming back under a
      // new id costs nothing: PRs, history and the week dots all recompute
      // from the list itself.
      onAction: () => void (async () => { await attemptWrite(() => svc.saveWorkout({ ...kept.data })); await reload(); })(),
    });
  };

  // ---- REORDER + DUPLICATE + MOVE (catalog §3.2-3.4) ----
  const reorderDays = async (weekId: string, orderedIds: string[]) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    if (!week) return;
    const byId = new Map(week.days.map((d) => [d.id, d]));
    await saveDays(weekId, orderedIds.map((id) => byId.get(id)).filter((d): d is ProgramDay => !!d));
  };
  const reorderExercises = async (weekId: string, dayId: string, orderedIds: string[]) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    const day = week?.days.find((d) => d.id === dayId);
    if (!week || !day) return;
    const byId = new Map(day.exercises.map((e) => [e.id, e]));
    const exercises = orderedIds.map((id) => byId.get(id)).filter((e): e is Exercise => !!e);
    await saveDays(weekId, week.days.map((d) => (d.id === dayId ? { ...d, exercises } : d)));
  };
  const duplicateDayAction = async (weekId: string, dayId: string) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    if (!week) return;
    // GYM-F-05 (2026-09-05): the copy carries the blocks, the minutes and the
    // A1/A2 pairs now, but not the pins -- two days in one week pinned to the
    // same weekday would both claim it on the calendar. Said out loud rather
    // than left to be discovered.
    const pinned = !!week.days.find((d) => d.id === dayId)?.pinDays?.length;
    if (await saveDays(weekId, duplicateDay(week, dayId).days)) {
      showToast({ message: pinned ? "Day duplicated · The copy is unpinned" : "Day duplicated" });
    }
  };
  const duplicateExerciseAction = async (weekId: string, dayId: string, exId: string) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    const day = week?.days.find((d) => d.id === dayId);
    if (!week || !day) return;
    if (await saveDays(weekId, week.days.map((d) => (d.id === dayId ? duplicateExercise(day, exId) : d)))) {
      showToast({ message: "Exercise duplicated" });
    }
  };
  const moveExerciseAction = async (fromDayId: string, exId: string, toDayId: string) => {
    if (!program) return;
    if (await saveWeeks(moveExerciseToDay(program.data.weeks, fromDayId, exId, toDayId))) {
      showToast({ message: "Exercise moved" });
    }
  };
  const copyExerciseAction = async (fromDayId: string, exId: string, toDayIds: string[]) => {
    if (!program) return;
    if (await saveWeeks(copyExerciseToDays(program.data.weeks, fromDayId, exId, toDayIds))) {
      showToast({ message: `Copied to ${toDayIds.length} ${toDayIds.length === 1 ? "day" : "days"}` });
    }
  };
  // UP-ATH-17 (2026-09-06): a group, however many. Two is the pair this has
  // always made; three or more is the tri-set and the circuit every coach's
  // sheet has on it and this app could not hold.
  const groupAction = async (weekId: string, dayId: string, aId: string, ids: string[]) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    const day = week?.days.find((d) => d.id === dayId);
    if (!week || !day || ids.length === 0) return;
    const next = groupExercises(day.exercises, aId, ids, () => nid("g"));
    if (await saveDays(weekId, week.days.map((d) => (d.id === dayId ? { ...d, exercises: next } : d)))) {
      const n = ids.length + 1;
      // IT SAYS WHERE IT LANDED, AND IT IS TAKE-BACK-ABLE (2026-09-21). This
      // is reachable from a LIVE session now ("Superset With..."), and a pair
      // is a program construct: it holds for every session after this one,
      // not just the workout you are standing in. A toast that says only
      // "Paired" would leave you to discover that next week. ungroupExercise
      // is the exact inverse and already existed for the program editor.
      showToast({
        message: n === 2 ? `Paired in ${workoutTitle(day.name)}` : capAfterNumber(`${n} grouped in ${workoutTitle(day.name)}`),
        actionLabel: "Undo",
        onAction: () => { void ungroupAction(weekId, dayId, aId); },
      });
    }
  };
  const ungroupAction = async (weekId: string, dayId: string, exId: string) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    const day = week?.days.find((d) => d.id === dayId);
    if (!week || !day) return;
    await saveDays(weekId, week.days.map((d) => (d.id === dayId ? { ...d, exercises: ungroupExercise(day.exercises, exId) } : d)));
  };
  // GYM-F-12 (2026-09-05): target first, source second, and the toast says
  // what actually happened. This used to remove the day from the source and
  // then append it to the target with no catch, so a second write that
  // failed left "Speed Work" in neither program while the toast never showed
  // (or, with a target that had no weeks, said "Moved" over a day that
  // appendDayToWeek had silently dropped). The ordering lives in edit.ts
  // where it can be tested against a writer that fails.
  const moveDayToProgramAction = async (_sourceWeekId: string, day: ProgramDay, targetProgramId: string, targetWeekId: string) => {
    if (!program) return;
    const target = programs.find((p) => p.id === targetProgramId);
    if (!target) return;
    const outcome = await moveDayBetweenPrograms(
      (id, weeks) => svc.updateProgram(id, { weeks }),
      { id: program.id, weeks: program.data.weeks },
      { id: target.id, weeks: target.data.weeks },
      day.id,
      targetWeekId,
    );
    if (outcome === "moved" && openDayId === day.id) setOpenDayId(null);
    await reload();
    if (outcome === "moved") showToast({ message: `Moved to ${target.data.name}` });
    else if (outcome === "landed") showToast({ message: `Copied to ${target.data.name} · Couldn't remove it here` });
    else showToast({ message: WRITE_FAILED_MESSAGE });
  };
  const duplicateProgramAction = async (p: Program) => {
    const ok = await attemptWrite(() => svc.createProgram(duplicateProgramData(p.data)));
    await reload();
    if (ok) showToast({ message: "Program duplicated" });
  };
  const archiveProgramAction = async (p: Program, archived: boolean) => {
    const ok = await attemptWrite(() => svc.updateProgram(p.id, { archived }));
    if (ok && archived && activeProgramId === p.id) {
      const next = programs.find((x) => x.id !== p.id);
      if (next) switchProgram(next.id);
    }
    await reload();
    if (ok) showToast({ message: archived ? "Program archived" : "Program restored" });
  };

  // ---- in-gym ----
  // Recover a stale session left from another day (2026-08-09): real work
  // gets saved as the partial workout it was; an empty shell just clears.
  // Without this, the next startDay would have silently destroyed it.
  // A BACKDATED session (catalog §3.8) is not stale just because its date is
  // not today, so it is left alone here. SESSIONS RESUME, NOT FRAGMENT
  // (2026-08-30): isStillActive also spares a session that crossed midnight
  // while still being actively logged -- only real inactivity lands here.
  // endedAt uses the session's last real write, not its start, so a
  // genuinely-recovered partial workout reports the time actually spent
  // rather than a 0-minute stamp.
  useEffect(() => {
    const s = readLive();
    if (!s || isStillActive(s, todayISO())) return;
    clearLive();
    if (hasWork(s.exercises)) {
      const endedAt = s.lastActivityAt ?? s.startedAt;
      queueFinished({ programId: s.programId, dayId: s.dayId, dayName: s.dayName, date: s.date, startedAt: s.startedAt, endedAt, exercises: s.exercises });
      void flushPending((w) => svc.saveWorkout(w)).then(() => reload());
      showToast({ message: `Saved unfinished ${s.dayName} · ${monthDay(s.date)}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastWorkoutForDay = useCallback((dayId: string): Workout | null => {
    for (let i = workouts.length - 1; i >= 0; i--) {
      if (workouts[i]!.data.dayId === dayId) return workouts[i]!;
    }
    return null;
  }, [workouts]);

  const startDay = (day: ProgramDay, opts: { date?: string; sameAsLastTime?: boolean; fit?: FitPlan; doorEventId?: string } = {}) => {
    if (!program) return;
    // Never overwrite logged work (2026-08-09): if a session with real sets
    // is already going -- today's or a still-open backdated one -- starting a
    // day RESUMES it instead of destroying it.
    const existing = readLive();
    if (existing && hasWork(existing.exercises)) {
      enterSession(existing);
      showToast({ message: "Resumed your open workout" });
      return;
    }
    const date = opts.date ?? todayISO();
    const backdated = date !== todayISO();
    const last = opts.sameAsLastTime ? lastWorkoutForDay(day.id) : null;
    const exercises = last
      ? sessionExercisesSameAsLastTime(day, last.data)
      // Part 3 wave 5 (O3a): the plan is copied in at start, so a program
      // edit made mid-session reaches the next session, never this one; and
      // the equipment convention rides with every set logged from here.
      // DOING TODAY (2026-09-21). The fit sheet's picks decide which of the
      // day's exercises this session is made of, and the same list priced the
      // minutes on that sheet, so what it said and what starts cannot drift.
      // No picks means the whole day, which is every caller that never asks.
      : dayUnderPlan(day, opts.fit ?? {}).exercises.map((e) => ({ exerciseId: e.id, name: e.name, kind: e.kind, unit: e.unit, timeUnit: e.timeUnit, exerciseKey: e.exerciseKey, sets: [], plan: e.sets, ...loadFields(e) }));
    const startedAt = Date.now();
    const s: LiveSession = {
      programId: program.id, dayId: day.id, dayName: day.name, date,
      startedAt, lastActivityAt: startedAt, idx: 0, exercises,
      ...(backdated ? { backdated: true } : {}),
      ...(opts.sameAsLastTime ? { sameAsLastTime: true } : {}),
      ...(opts.fit ?? {}),
      ...(opts.doorEventId ? { doorEventId: opts.doorEventId } : {}),
    };
    writeLive(s);
    emit({ type: "health.logged", props: { kind: "workout_started" } });
    // UP-PLAT-26 (2026-09-06): the "gym" WorkSpot kind was declared in
    // restore/whereYouWere.ts:8-13 and nothing in src/gym ever wrote one, so
    // two of the banner's four kinds never fired. The live-session card on
    // Today covers the same session while it is still live; this covers the
    // day after, when the session has gone stale and the only thing left is
    // a bookmark back to the gym.
    if (areaId) recordSpot({ kind: "gym", id: areaId, label: day.name });
    enterSession(s);
    if (opts.sameAsLastTime && !last) showToast({ message: "No prior session for this day yet · Starting fresh" });
  };
  // D5: every live start passes through the fit sheet -- except the paths
  // whose whole point is speed or the past: a resume (the sheet was already
  // answered), Same as Last Time (the fastest possible entry), a backdated
  // log (there is no clock to fit against), and an empty day (nothing to
  // price).
  const requestStart = (day: ProgramDay, extra: { doorEventId?: string; budgetMin?: number } = {}) => {
    const existing = readLive();
    if (existing && hasWork(existing.exercises)) { startDay(day); return; }
    if (day.exercises.length === 0) { startDay(day, { doorEventId: extra.doorEventId }); return; }
    setFitFor({ day, doorEventId: extra.doorEventId, budgetMin: extra.budgetMin });
  };

  // THE HEALTH HERO'S START (2026-09-02): the same walk-in the door makes,
  // for the day the Health page named. A live session in progress resumes
  // instead, which is what the door does too.
  const [startHandled, setStartHandled] = useState(false);
  useEffect(() => {
    if (!startDayId || startHandled || !loaded) return;
    setStartHandled(true);
    const existing = readLive();
    if (existing && hasWork(existing.exercises) && isStillActive(existing, todayISO())) { enterSession(existing); return; }
    if (!program) return;
    // The scratch sentinel is not a program day and never will be: it starts
    // an empty session the athlete fills with Add Exercise. requestStart
    // already routes an exercise-free day straight past the fit sheet.
    if (startDayId === SCRATCH_DAY_ID) {
      requestStart({ id: SCRATCH_DAY_ID, name: SCRATCH_DAY_NAME, exercises: [] }, { doorEventId: startDoorEventId });
      return;
    }
    const day = program.data.weeks.flatMap((w) => w.days).find((d) => d.id === startDayId);
    if (day) requestStart(day, { doorEventId: startDoorEventId, budgetMin: startBudgetMin });
  }, [startDayId, startDoorEventId, startBudgetMin, startHandled, loaded, program]);

  // 2026-09-14: a saved session named on the way in opens in its editor
  // once the list has loaded (the Duration finding's way to the card).
  const [workoutHandled, setWorkoutHandled] = useState(false);
  useEffect(() => {
    if (!startWorkoutId || workoutHandled || !loaded) return;
    setWorkoutHandled(true);
    const w = workouts.find((x) => x.id === startWorkoutId);
    if (w) { setViewWorkout(w); setWorkoutDraft(w.data.exercises); }
  }, [startWorkoutId, workoutHandled, loaded, workouts]);

  // THE DOOR OPENS (D4-C): mounted from the calendar's gym block. The
  // pinned day walks straight into the fit sheet; no pin, it asks once.
  useEffect(() => {
    if (!door || doorHandled || !loaded) return;
    setDoorHandled(true);
    const existing = readLive();
    if (existing && hasWork(existing.exercises) && isStillActive(existing, todayISO())) { enterSession(existing); return; }
    if (!program) return;
    const days = program.data.weeks.flatMap((w) => w.days);
    const pinned = pinnedTo(days, todayDow());
    if (pinned) requestStart(pinned, { doorEventId: door.eventId, budgetMin: door.budgetMin });
    else setDoorPick(true);
  }, [door, doorHandled, loaded, program]);

  // Every logged change re-stamps lastActivityAt (2026-08-30, sessions
  // resume not fragment): this is the one door all of SessionScreen's
  // mutations pass through, so it is the one place that needs to know a
  // session is still being actively used.
  const update = (next: LiveSession) => {
    const stamped = { ...next, lastActivityAt: Date.now() };
    writeLive(stamped);
    liveRef.current = stamped;
    setLive(stamped);
  };
  // GYM-F-01 (2026-09-05): one tap on Log Set now writes the session twice
  // in the same handler (the set, then the rest deadline), and Or Do Filler
  // moves the index and clears the rest in one go. Two writes built off the
  // same render's `live` would each start from the stale copy and the second
  // would silently drop the first -- a logged set gone. Every SessionScreen
  // handler patches off the freshest session instead, so writes compose.
  const patchLive = (fn: (s: LiveSession) => LiveSession) => {
    const cur = liveRef.current;
    if (cur) update(fn(cur));
  };

  // D6-A. The suggestion was a ghost until here: accepting writes the new
  // target into the PROGRAM day this exercise belongs to, through the same
  // saveDays door every other program edit uses, and says so out loud.
  const acceptSuggestion = async (ex: Exercise, sug: Suggestion) => {
    if (!program || !live) return;
    const week = program.data.weeks.find((w) => w.days.some((d) => d.id === live.dayId));
    const day = week?.days.find((d) => d.id === live.dayId);
    if (!week || !day) return;
    // GYM-F-16 (2026-09-05): Swap deliberately keeps the ORIGINAL slot's
    // exerciseId so the This Session list stays stable
    // (liveSession.ts:169-177), and this handler trusted that id as a program
    // identity. Swap Bench for DB Press, accept DB Press's suggestion, and the
    // toast said "DB Press plan moved to 55 lb x 10" while the program's BENCH
    // strip was what changed. The set is logged either way (SessionScreen logs
    // it before calling this); only a lift that really is this program
    // exercise moves the program's own plan.
    const entry = live.exercises[live.idx];
    const behind = entry ? programExerciseFor(entry, day) : undefined;
    if (!behind || behind.id !== ex.id) {
      showToast({ message: `Set logged · ${ex.name} is not in this day's plan, so nothing moved` });
      return;
    }
    const days = week.days.map((d) => (d.id !== day.id ? d : {
      ...d, exercises: d.exercises.map((e) => (e.id === ex.id ? applySuggestion(e, sug) : e)),
    }));
    if (await saveDays(week.id, days)) {
      showToast({ message: `${ex.name} plan moved to ${formatSet(ex, sug.next)}` });
    }
  };

  // HOW A LIFT LOADS, ANSWERED FROM THE RACK (2026-09-16, Dave: "I don't even
  // have the option while I'm logging to select what type of weight system it
  // is"). Two writes, and both are needed for different reasons.
  //
  // The LIVE entry takes it first and unconditionally, because that is what
  // makes the strip's steppers, its labels and the plate calculator right for
  // the set he is about to do -- and because WorkoutExercise carries the
  // convention into the saved record, so these sets are filed under what they
  // actually were. This is the only write a swapped or added lift can take;
  // it is not in the program, and this session is the whole of its life.
  //
  // The PROGRAM's exercise takes it too when the lift really is in this day's
  // plan, because equipment is a fact about a lift and not about an
  // afternoon: answering it once should not have to be answered again next
  // week. Same identity check acceptSuggestion makes, and for the same
  // reason -- Swap keeps the original slot's exerciseId (liveSession.ts), so
  // trusting that id would write a dumbbell's reading onto the barbell lift
  // it replaced.
  const setLoadStyle = async (ex: Exercise, next: LoadStyle) => {
    const patch = {
      equipment: next.equipment,
      counted: next.counted,
      ...(next.sided ? { sided: true as const } : { sided: undefined }),
    };
    patchLive((l) => ({
      ...l,
      exercises: l.exercises.map((e, i) => (i === l.idx ? { ...e, ...patch } : e)),
    }));
    if (!program || !live) return;
    const week = program.data.weeks.find((w) => w.days.some((d) => d.id === live.dayId));
    const day = week?.days.find((d) => d.id === live.dayId);
    if (!week || !day) return;
    const entry = live.exercises[live.idx];
    const behind = entry ? programExerciseFor(entry, day) : undefined;
    if (!behind || behind.id !== ex.id) return;
    await saveDays(week.id, week.days.map((d) => (d.id !== day.id ? d : {
      ...d, exercises: d.exercises.map((e) => (e.id === ex.id ? { ...e, ...patch } : e)),
    })));
  };

  // THE FINISH IS TWO STEPS (H-30, Health Push B, 2026-09-12). The receipt
  // opens BEFORE anything is written: Done commits the session, with the note
  // if he wrote one, and Keep Training closes the receipt and leaves the
  // session exactly where it was. The live session stays in storage the whole
  // time, so an app killed mid-receipt resumes the session rather than losing
  // it. The goal hits are computed here against the pending workout; the
  // close-out is still his tap on the receipt (Dave 2026-09-09).
  const finish = async (opts: { force?: boolean } = {}) => {
    if (!live) return;
    if (!opts.force) {
      const twin = twinWorkout(workouts, live) as Workout | null;
      if (twin) { setDupFinish({ twin }); return; }
    }
    if (!hasWork(live.exercises)) {
      clearLive();
      enterSession(null);
      setOpenDayId(null);
      await reload();
      showToast({ message: "Nothing logged · Nothing saved" });
      return;
    }
    const endedAt = Date.now();
    const pausedMs = live.pausedMs ?? 0;
    const r = receiptFor(live.exercises, workouts, live.startedAt, endedAt, pausedMs);
    const data: WorkoutData = {
      programId: live.programId, dayId: live.dayId, dayName: live.dayName, date: live.date,
      startedAt: live.startedAt, endedAt, exercises: live.exercises,
      ...(live.backdated ? { backdated: true } : {}),
      ...(pausedMs > 0 ? { pausedMs } : {}),
    };
    // D12: did this session cross a goal from not-met to met? Checked
    // against the SAME before/after evidence goalMeasures.ts always reads
    // (workouts before this session, then with it). A goal already achieved
    // is never re-celebrated, and hitting the number is not saying it is
    // done: the close-out is a button on the receipt.
    const goalHits: { id: string; title: string; line: string }[] = [];
    if (goalsSvc) {
      const after: Workout[] = [...workouts, { id: "pending", data }];
      for (const g of goals) {
        if (g.data.state === "achieved") continue;
        const m = g.data.measure;
        if (!m || (m.kind !== "lift" && m.kind !== "training")) continue;
        const before = m.kind === "lift" ? liftMeasureState(m as LiftMeasure, workouts) : trainingMeasureState(m as TrainingMeasure, workouts, endedAt);
        if (before.met) continue;
        const afterState = m.kind === "lift" ? liftMeasureState(m as LiftMeasure, after) : trainingMeasureState(m as TrainingMeasure, after, endedAt);
        if (afterState.met) goalHits.push({ id: g.id, title: g.data.title, line: afterState.line });
      }
    }
    finishing.current = { data, door: live.doorEventId ? { id: live.doorEventId, date: live.date } : null };
    setReceipt({ receipt: { ...r, goalHits }, dayName: live.dayName });
  };
  const commitFinish = async (note?: string) => {
    const f = finishing.current;
    finishing.current = null;
    setReceipt(null);
    if (!f) return;
    const text = note?.trim();
    const data: WorkoutData = text ? { ...f.data, note: text } : f.data;
    clearLive();
    enterSession(null);
    // Land on the day list, not back on the exercise: the day detail is a
    // dead end after a session, while the program page shows what just
    // happened and what is next.
    setOpenDayId(null);
    // Queue first, then try: a failed write must never lose the session.
    queueFinished(data);
    await flushPending((w) => svc.saveWorkout(w));
    // D4-C: "when you finish, the block stamps itself done with the real
    // minutes." Only a session that walked in through the door stamps it,
    // and a failed stamp never blocks anything.
    if (f.door && schedule) {
      try { await schedule.stampTrained(f.door.id, f.door.date, workoutMinutes(data)); } catch { /* offline: the workout is safe, the stamp can wait */ }
    } else if (schedule) {
      // Part 3 wave 5 (O6a): a session started from the gym still stamps the
      // day's gym event, if there is exactly one, so the schedule row and the
      // session are one record; nothing is written twice.
      try {
        const { occursOn } = await import("../schedule/calendar");
        const doors = (await schedule.listEvents()).filter((e) => e.data.gym && occursOn(e.data, data.date));
        if (doors.length === 1) await schedule.stampTrained(doors[0]!.id, data.date, workoutMinutes(data));
      } catch { /* offline: the workout is safe, the stamp can wait */ }
    }
    await reload();
  };
  const keepTraining = () => {
    finishing.current = null;
    setReceipt(null);
  };
  const dupEl = dupFinish && live
    ? <ActionSheet
        title={`${live.dayName} Was Already Saved Today`}
        actions={[
          { label: "Save This One Too", onClick: () => { setDupFinish(null); void finish({ force: true }); } },
          { label: "Discard This One", onClick: () => { setDupFinish(null); clearLive(); enterSession(null); setOpenDayId(null); showToast({ message: "Discarded · The saved session stays" }); } },
        ]}
        onClose={() => setDupFinish(null)}
      />
    : null;
  const receiptEl = receipt
    ? <ReceiptSheet
        dayName={receipt.dayName}
        receipt={receipt.receipt}
        celebrations={celebrations}
        // The session is not saved until Done, so the receipt's own counts
        // include it here (GYM-F-27 wanted the count right, not one behind).
        workouts={finishing.current ? [...workouts, { id: "pending", data: finishing.current.data } as Workout] : workouts}
        onDone={(note) => void commitFinish(note)}
        onKeepTraining={live ? keepTraining : undefined}
        onRateSession={onRateSession}
        onLogSoreSpot={onLogSoreSpot}
        onAchieveGoal={goalsSvc ? (id) => {
          // His tap, his write. Offline it fails quietly the way every other
          // gym write does: the workout is already saved, and the goal simply
          // stays open until the next tap lands.
          void (async () => {
            try { await goalsSvc.update(id, { state: "achieved" }); await reload(); } catch { /* offline: the goal stays open, nothing is lost */ }
          })();
        } : undefined}
      />
    : null;

  if (uploadOpen) {
    return <UploadFlow ai={ai} onSave={(p) => void saveUploaded(p)} onCancel={() => setUploadOpen(false)} />;
  }
  // GYM-F-30 (2026-09-05): History used to close itself on the way into a
  // lift, so Back from the lift detail landed on the program page rather than
  // the list the athlete came from. It stays open underneath now, and the
  // lift branch is checked first so it renders on top of it.
  if (liftDetailFor) {
    // Muscle group is a PROGRAM fact (D13-C), read off the CURRENT program's
    // own exercise by name -- absent when untagged, or when the lift has
    // since been renamed or removed from the plan; the range row simply
    // does not claim it then.
    // 2026-09-14: the per-lift tags come first. They are keyed to the lift's
    // stable identity, so unlike the program-day tag they survive a rename,
    // an archived program and a lift that only ever existed mid-session.
    const gs = readGymSettings();
    const taggedHere = (liftDetailFor.exerciseKey ? gs.muscleByKey?.[liftDetailFor.exerciseKey] : undefined)
      ?? gs.muscleByKey?.[liftDetailFor.name];
    const muscleGroup = (taggedHere?.[0] as MuscleGroup | undefined) ?? program?.data.weeks
      .flatMap((w) => w.days)
      .flatMap((d) => d.exercises)
      .find((e) => e.name === liftDetailFor.name)?.muscleGroup;
    // GYM-F-15 (2026-09-05): the whole program map, not just this lift, so
    // the weekly hard-set row can sum the muscle the way the Health page
    // does instead of reporting one lift under the muscle's name.
    // EVERY program, plus the per-lift tags (2026-09-14). Reading one
    // program meant a lift tagged anywhere else counted for nothing.
    const muscleMap = muscleMapFrom(allPrograms, gs.muscleByKey ?? {}, gs.classByKey ?? {});
    // The classification for the exercise on screen, and the row it belongs
    // to, so the same shared editor can be opened from here and write to the
    // same place the library writes to.
    const detailRow = libraryRows(library, workouts, hiddenKeys).find((r) =>
      (liftDetailFor.exerciseKey ? r.exerciseKey === liftDetailFor.exerciseKey : false) || r.name === liftDetailFor.name) ?? null;
    const detailClass = detailRow ? classOf(classStore, detailRow, loadStyleOf(detailRow)) : undefined;
    const detailNote = allPrograms
      .flatMap((p) => p.data.weeks)
      .flatMap((w) => w.days)
      .flatMap((d) => d.exercises)
      .find((e) => (liftDetailFor.exerciseKey ? e.exerciseKey === liftDetailFor.exerciseKey : e.name === liftDetailFor.name))?.note;
    // GYM-F-04 (2026-09-05): a goal set before a rename still belongs to this
    // lift, so it is found by identity, not by whichever name it was stored
    // under.
    const goal = goals.find((g) => {
      if (g.data.state === "achieved" || g.data.measure?.kind !== "lift") return false;
      const m = g.data.measure as LiftMeasure;
      return sameLiftAnyKind({ name: m.exercise, exerciseKey: m.exerciseKey }, liftDetailFor);
    });
    return (
      <>
        <LiftDetailScreen
          {...liftDetailFor}
          workouts={workouts}
          muscleGroup={muscleGroup}
          muscleMap={muscleMap}
          defs={metricDefs}
          logs={metricLogs}
          goal={goal}
          onSetGoal={() => setLiftGoalSheetOpen(true)}
          {...(detailClass ? { classification: detailClass } : {})}
          {...(detailRow ? { onEditClass: (open) => setClassOpen({ row: detailRow, open }) } : {})}
          {...(detailNote ? { note: detailNote } : {})}
          onOpenLogs={() => { setLiftDetailFor(null); setHistoryOpen(true); setHistoryMode("sessions"); }}
          onBack={() => setLiftDetailFor(null)}
        />
        {/* The one classification editor, reachable from the exercise page as
            well as the library (§8), writing to the same store. */}
        {classOpen && (
          <ClassifySheet
            name={classOpen.row.name}
            initial={classOf(classStore, classOpen.row, loadStyleOf(classOpen.row))}
            open={classOpen.open}
            todayIso={todayISO()}
            askScope={!needsMuscles(classOf(classStore, classOpen.row, loadStyleOf(classOpen.row)))}
            onSave={(next, scope) => {
              const r = classOpen.row;
              setClassOpen(null);
              const store = { ...classStore };
              if (isBlank(next)) delete store[r.key]; else store[r.key] = next;
              saveClassStore(store);
              showToast({ message: scope === "all" ? "Muscles updated" : scope === "future" ? "Muscles updated from today on" : "Muscles updated for existing records" });
            }}
            onCancel={() => setClassOpen(null)}
          />
        )}
        {/* GYM-F-28 (2026-09-05): the sheet has taken `initial` and `onDelete`
            since it was written and nothing ever passed them, so a lift goal
            set here could only be edited or removed from Bigger Picture. Both
            seams are wired now, and both writes report their own failure
            instead of closing the sheet on a write that never landed. */}
        {liftGoalSheetOpen && (
          <LiftGoalSheet
            exercise={liftDetailFor.name}
            exerciseKey={liftDetailFor.exerciseKey}
            kind={liftDetailFor.kind}
            unit={liftDetailFor.unit}
            timeUnit={liftDetailFor.timeUnit}
            {...(goal ? { initial: { title: goal.data.title, ...(goal.data.measure ? { measure: goal.data.measure as LiftMeasure } : {}), ...(goal.data.by ? { by: goal.data.by } : {}) } } : {})}
            healthCategoryIds={healthCategoryIds}
            onSave={async (data) => {
              if (!goalsSvc) { setLiftGoalSheetOpen(false); return; }
              const ok = await attemptWrite(() => (goal ? goalsSvc.update(goal.id, data) : goalsSvc.create(data)));
              if (!ok) return;
              setGoals(await goalsSvc.list());
              setLiftGoalSheetOpen(false);
            }}
            {...(goal && goalsSvc ? {
              onDelete: async () => {
                // UP-ATH-08 (2026-09-06): reversible without a confirm, like
                // every other delete in this app. GoalService.create takes an
                // explicit id, so Undo puts back the SAME goal, not a copy of
                // it, and anything pointing at that id still points at it.
                const snapshot = goal.data;
                const ok = await attemptWrite(() => goalsSvc.remove(goal.id));
                if (!ok) return;
                setGoals(await goalsSvc.list());
                setLiftGoalSheetOpen(false);
                showToast({
                  message: "Goal deleted",
                  actionLabel: "Undo",
                  onAction: () => void (async () => {
                    const back = await attemptWrite(() => goalsSvc.create(snapshot, goal.id));
                    if (back) setGoals(await goalsSvc.list());
                  })(),
                });
              },
            } : {})}
            onCancel={() => setLiftGoalSheetOpen(false)}
          />
        )}
      </>
    );
  }
  // H-32: a session row opens the workout's own screen (the branch above
  // this one), and closing it lands back on History.
  if (historyOpen && !viewWorkout) {
    return (
      <HistoryScreen workouts={workouts} onBack={() => setHistoryOpen(false)} onOpenLift={(row) => setLiftDetailFor(row)}
        onOpenWorkout={(w) => { setViewWorkout(w); setWorkoutDraft(w.data.exercises); }}
        mode={historyMode} onMode={setHistoryMode} />
    );
  }
  // EXERCISES, THE PAGE (was Your Lifts). Every write here goes through one
  // door, one update per touched workout and program, each guarded: a bulk
  // rewrite that fails partway says so rather than leaving the library half
  // renamed in silence.
  if (libraryOpen) {
    const rowsNow = () => libraryRows(library, workouts, hiddenKeys);
    const applyPatch = async (patch: ReturnType<typeof renameLift>, said: string, after?: () => void, undo?: () => void) => {
      if (isEmptyPatch(patch)) return;
      const ok = await attemptWrite(async () => {
        for (const w of patch.workouts) await svc.updateWorkout(w.id, { exercises: w.exercises });
        for (const p of patch.programs) await svc.updateProgram(p.id, { weeks: p.weeks });
      });
      await reload();
      if (ok) { showToast({ message: said, ...(undo ? { actionLabel: "Undo", onAction: undo } : {}) }); after?.(); }
    };

    /** Build the plan for one ordered pair. Called again on Swap and on
     *  Retry, so the plan is always computed from the CURRENT records rather
     *  than from whatever the sheet was opened with -- which is what makes a
     *  retry after a partial write finish the job instead of redoing it. */
    const buildPlan = (keep: LibraryRow, fold: LibraryRow): MergePlan | null => {
      if (keep.key === fold.key || keep.kind !== fold.kind) return null;
      const survivorKey = keep.exerciseKey ?? newExerciseKey();
      const patch = mergeLifts(workouts, allPrograms, fold, { ...keep, exerciseKey: survivorKey }, () => survivorKey);
      return planMerge({
        keep: { row: keep, classification: classOf(classStore, keep, loadStyleOf(keep)) },
        fold: { row: fold, classification: classOf(classStore, fold, loadStyleOf(fold)) },
        patch,
        inverse: invertPatch(patch, workouts, allPrograms),
        survivorKey,
        workouts,
        programs: allPrograms,
        goals,
      });
    };

    /**
     * THE MERGE ITSELF (handoff §5, steps 6 to 8).
     *
     * Pending goes on before the first write and comes off only when every
     * write has returned. Each write is counted, so a failure reports what
     * landed and Retry can finish the rest -- the patch is idempotent, so
     * re-running the whole thing is safe and converges.
     *
     * Nothing says "merged" until persistence returns. On failure the review
     * item STAYS, with the count and a Retry, because a failed merge that
     * looks like it worked is the defect this whole rewrite is about.
     */
    const runMerge = async (state: MergeState) => {
      const plan = state.plan;
      setMergeState({ ...state, stage: "pending" });
      let applied = 0;
      let failed = false;
      try {
        for (const w of plan.patch.workouts) { await svc.updateWorkout(w.id, { exercises: w.exercises }); applied++; }
        for (const p of plan.patch.programs) { await svc.updateProgram(p.id, { weeks: p.weeks }); applied++; }
        // The goal follows its exercise. Same write door, same counting: a
        // goal left pointing at a folded-away name is a goal that silently
        // stops seeing its own lift.
        if (goalsSvc) {
          for (const g of plan.goals) await goalsSvc.update(g.id, repointGoal(g, plan.keep.row, plan.survivorKey));
        }
      } catch {
        failed = true;
      }
      await reload();
      if (goalsSvc) setGoals(await goalsSvc.list());
      if (failed) {
        setMergeState({ ...state, stage: "failed", applied });
        return;
      }
      // Only now: the aliases, the classification, the history record, the
      // receipt. The folded name becomes a searchable alias (criterion 10),
      // and the merged classification takes the conflicts as resolved.
      const aliasesBefore = aliasMap;
      saveAliases(aliasesAfterMerge(aliasMap, {
        loserKey: plan.fold.row.key,
        loserName: plan.fold.row.name,
        survivorKey: plan.keep.row.key,
        survivorNewKey: plan.survivorKey,
        survivorName: plan.keep.row.name,
      }));
      const storeBefore = classStore;
      const merged = mergeClass(plan.keep.classification, plan.fold.classification, state.take as ClassConflict["field"][]);
      const nextStore: ClassStore = { ...classStore };
      delete nextStore[plan.fold.row.key];
      delete nextStore[plan.keep.row.key];
      if (!isBlank(merged)) nextStore[plan.survivorKey] = merged;
      saveClassStore(nextStore);
      const dupeId = pairId(plan.keep.row.key, plan.fold.row.key);
      const dismissedBefore = dismissedDupes;
      const nextDismissed = dismissedDupes.includes(dupeId) ? dismissedDupes : [...dismissedDupes, dupeId];
      setDismissedDupes(nextDismissed);
      writeGymSettings({ ...readGymSettings(), dismissedDupes: nextDismissed });
      const gs = readGymSettings();
      writeGymSettings({
        ...gs,
        merges: [...(gs.merges ?? []), {
          at: Date.now(),
          loserName: plan.fold.row.name,
          survivorName: plan.keep.row.name,
          survivorKey: plan.survivorKey,
          sessions: plan.sessions,
          programDays: plan.programDays,
        }].slice(-50),
      });
      setMergeState(null);
      // UNDO, ONLY WHILE IT IS SAFE. The pre-image is the records as they
      // were before this write; if anything touches them afterwards, undoing
      // would throw that newer work away. The check runs at TAP time, on the
      // records as they are then.
      showToast({
        message: "Exercises merged",
        actionLabel: "View Exercise",
        onAction: () => setLiftDetailFor({
          name: plan.keep.row.name,
          kind: plan.keep.row.kind,
          exerciseKey: plan.survivorKey,
          ...(plan.keep.row.unit ? { unit: plan.keep.row.unit } : {}),
        }),
      });
      // The reversal is offered as its own second receipt so the first one
      // can carry View Exercise, which is what the handoff asks step 8 to
      // show. Both are facts about the same landed write.
      showToast({
        message: `${plan.fold.row.name} is now ${plan.keep.row.name}`,
        actionLabel: "Undo",
        onAction: () => void (async () => {
          // TWO DIFFERENT READINGS, or this check is not a check: the records
          // as they are at the moment of the tap, against what the patch said
          // they would be. If anything has edited them since -- another merge,
          // an edited session -- the pre-image is stale and putting it back
          // would throw that newer work away without saying so.
          const now = recordsRef.current;
          const safe = undoSafe(plan, patchSignature(plan.patch, now.workouts, now.programs), expectedSignature(plan.patch));
          if (!safe) { showToast({ message: "Too much has changed since to undo this safely" }); return; }
          await applyPatch(plan.inverse, "Merge undone", () => {
            saveAliases(aliasesBefore);
            saveClassStore(storeBefore);
            setDismissedDupes(dismissedBefore);
            writeGymSettings({ ...readGymSettings(), dismissedDupes: dismissedBefore });
          });
          if (goalsSvc) {
            // The last unguarded write in the app after the states sweep of
            // 2026-09-20: a restore loop inside a void async, so a rejection
            // had nowhere to go and the goals would silently stay changed.
            await attemptWrite(async () => {
              for (const g of plan.goals) await goalsSvc.update(g.id, g.data);
            });
            setGoals(await goalsSvc.list());
          }
        })(),
      });
    };

    return (
      <>
        <LibraryPage
          rows={rowsNow()}
          store={classStore}
          todayIso={todayISO()}
          onOpen={(r) => setLiftDetailFor({ name: r.name, kind: r.kind, ...(r.exerciseKey ? { exerciseKey: r.exerciseKey } : {}), ...(r.unit ? { unit: r.unit } : {}) })}
          // CREATE ONE HERE (Dave 2026-09-17). The name is taken as typed --
          // an exercise is not a workout title, and LAW 18 says the app never
          // rewrites what the athlete called a lift. A name already in the
          // library at the same measurement is not created twice; the row is
          // already there, so saying so beats quietly minting a duplicate for
          // the merge review to find next week.
          onCreate={(draft) => {
            const name = draft.name.trim();
            const twin = library.find((e) => e.name.trim().toLowerCase() === name.toLowerCase() && e.kind === draft.kind);
            if (twin) { showToast({ message: `${twin.name} is already here` }); return; }
            const cased = liftTitle(name);
            const key = draft.exerciseKey ?? newExerciseKey();
            // The sheet is the whole editor now, so whatever it was told
            // travels with the seed rather than being asked for again the
            // first time the lift is used.
            saveCreatedLifts([...createdLifts, {
              key, name: cased, kind: draft.kind,
              ...(draft.unit ? { unit: draft.unit } : {}),
              ...loadFields(draft),
            }]);
            // A muscle is a CLASSIFICATION, not a property of the entry, so it
            // goes where every other muscle assignment goes -- which is also
            // what takes the amber Assign Muscles chip off the new row.
            if (draft.muscleGroup) {
              saveClassStore({ ...classStore, [key]: { ...EMPTY_CLASS, primary: [draft.muscleGroup], measure: draft.kind, ...loadFields(draft) } });
            }
            showToast({ message: `${cased} added` });
          }}
          // THE GOAL OPTION, WHERE THE EXERCISE IS (Dave 2026-09-12: "the list
          // of exercises there's a goal option"). Walks into the exercise it is
          // about and opens the same LiftGoalSheet its own page opens, rather
          // than a second, poorer sheet built here that would have had to ask
          // which exercise first.
          onSetGoal={(r) => {
            setLiftDetailFor({ name: r.name, kind: r.kind, ...(r.exerciseKey ? { exerciseKey: r.exerciseKey } : {}), ...(r.unit ? { unit: r.unit } : {}) });
            setLiftGoalSheetOpen(true);
          }}
          // H-23: the key is stamped here rather than inside the patch, so the
          // old name can be filed under the key the lift carries afterwards.
          onRename={(r, name) => {
            const stamped = r.exerciseKey ?? newExerciseKey();
            void applyPatch(renameLift(workouts, allPrograms, { ...r, exerciseKey: stamped }, name, () => stamped), `Renamed to ${name.trim()}`,
              () => {
                saveAliases(aliasesAfterRename(aliasMap, r.key, stamped, r.name, name.trim()));
                // The classification follows the key it was filed under, or
                // the rename would quietly un-classify the exercise.
                if (stamped !== r.key && classStore[r.key]) {
                  const next = { ...classStore };
                  next[stamped] = next[r.key]!;
                  delete next[r.key];
                  saveClassStore(next);
                }
              });
          }}
          // ONE CLASSIFICATION WRITE (§4). It lands in the store, it refreshes
          // the chips and the Insights that read it on the next render, and it
          // says so. The scope the athlete picked rides along on the object.
          onSetClass={(r, next, scope) => {
            const store = { ...classStore };
            if (isBlank(next)) delete store[r.key]; else store[r.key] = next;
            saveClassStore(store);
            showToast({
              message: scope === "all" ? "Muscles updated"
                : scope === "future" ? "Muscles updated from today on"
                  : "Muscles updated for existing records",
            });
          }}
          onBatch={(next, changed) => {
            saveClassStore(next);
            showToast({ message: changed === 1 ? "1 exercise updated" : `${changed} exercises updated` });
          }}
          // The page never merges. It asks for a review, and the review runs
          // the write above.
          onMerge={(keep, fold) => {
            const plan = buildPlan(keep, fold);
            if (!plan) { showToast({ message: "Those two log differently, so their numbers cannot share one history" }); return; }
            setMergeState({ plan, stage: "reviewing", take: [], applied: 0 });
          }}
          onToggleFavorite={(r) => {
            const next = favoriteKeys.includes(r.key) ? favoriteKeys.filter((k) => k !== r.key) : [...favoriteKeys, r.key];
            setFavoriteKeys(next);
            writeGymSettings({ ...readGymSettings(), favoriteKeys: next });
            showToast({ message: r.favorite ? `${r.name} is no longer a favorite` : `${r.name} leads the pickers now` });
          }}
          onToggleHidden={(r) => {
            const next = hiddenKeys.includes(r.key) ? hiddenKeys.filter((k) => k !== r.key) : [...hiddenKeys, r.key];
            setHiddenKeys(next);
            writeGymSettings({ ...readGymSettings(), hiddenKeys: next });
            showToast({ message: r.hidden ? `${r.name} is offered again` : `${r.name} hidden from suggestions` });
          }}
          dismissedDupes={dismissedDupes}
          onDismissDuplicate={(id) => {
            const next = dismissedDupes.includes(id) ? dismissedDupes : [...dismissedDupes, id];
            setDismissedDupes(next);
            writeGymSettings({ ...readGymSettings(), dismissedDupes: next });
            showToast({ message: "Kept separate" });
          }}
          onBack={() => setLibraryOpen(false)}
        />
        {mergeState && (
          <MergeReviewSheet
            state={mergeState}
            onSwap={() => {
              const flipped = buildPlan(mergeState.plan.fold.row, mergeState.plan.keep.row);
              if (flipped) setMergeState({ plan: flipped, stage: "reviewing", take: [], applied: 0 });
            }}
            onTake={(field) => setMergeState((s) => (s ? {
              ...s,
              take: s.take.includes(field) ? s.take.filter((f) => f !== field) : [...s.take, field],
            } : s))}
            onMerge={() => {
              // A retry re-plans from the records as they are now, so a
              // partial first attempt is finished rather than repeated.
              if (mergeState.stage === "failed") {
                const fresh = buildPlan(mergeState.plan.keep.row, mergeState.plan.fold.row);
                void runMerge(fresh
                  ? { ...mergeState, plan: fresh, stage: "reviewing" }
                  : mergeState);
                return;
              }
              void runMerge(mergeState);
            }}
            onCancel={() => setMergeState(null)}
          />
        )}
      </>
    );
  }
  if (viewWorkout && workoutDraft) {
    const w = viewWorkout;
    const dirty = JSON.stringify(workoutDraft) !== JSON.stringify(w.data.exercises);
    const closeWorkout = () => {
      setViewWorkout(null); setWorkoutDraft(null);
      setWorkoutMetaOpen(false); setWorkoutExMenu(null); setWorkoutExRename(null); setWorkoutAddOpen(false);
    };
    const patchDraft = (fn: (d: WorkoutExercise[]) => WorkoutExercise[]) => setWorkoutDraft((d) => (d ? fn(d) : d));
    /** The session's own two facts, written straight through rather than held
     *  in the exercise draft: they are not sets, and DurationCard next to them
     *  has corrected the end time this way since it shipped. */
    const saveWorkoutMeta = async (next: { dayName: string; date: string }) => {
      setWorkoutMetaOpen(false);
      // The clock stamps travel with the day, so a session moved to Tuesday
      // still says it happened at six in the evening. See edit.movedToDay.
      const moved = movedToDay(w.data, next.date);
      const patch = { dayName: next.dayName, ...(moved ?? {}) };
      if (patch.dayName === w.data.dayName && !moved) return;
      const ok = await attemptWrite(() => svc.updateWorkout(w.id, patch));
      await reload();
      if (!ok) return;
      setViewWorkout({ ...w, data: { ...w.data, ...patch } });
      showToast({ message: "Session updated" });
    };
    return (
      <div className="screen ruled health-ruled">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={closeWorkout}></button>
          <div className="nav-title">{workoutTitle(w.data.dayName)}</div>
          {/* The name and the date are what history is read by, and a session
              logged from memory the next morning gets both wrong. */}
          <button className="nav-action-text" onClick={() => setWorkoutMetaOpen(true)}>Edit</button>
        </div>
        {/* Meta, not a kicker: inside .grp a bare eyebrow inherits the
            accent-chrome kicker red, and this line is information (RED IS A
            VERB). Quiet sentence-case meta like every other date line. */}
        {/* §AM (2026-09-26): the minutes sit in a .facts line so they take
            the facts' size and grey rather than the body's 17px white, and
            "Logged Later" is provenance, not a warning, so it wears the
            neutral date chip rather than Health's amber. */}
        <div className="pad-x"><div className="se-chips">
          <span className="se-chip se-chip-when">{monthDay(w.data.date)}</span>
          <div className="facts">{minutesFact(w.data)}</div>
          {w.data.backdated && <span className="se-chip se-chip-when">Logged Later</span>}
        </div></div>
        {/* THE DURATION, SHOWN AND CORRECTABLE (2026-09-14, item 9). The
            card says how the minutes were made; a correction is a revision
            that keeps the value it replaced, and every total downstream
            reads the corrected stamp on the next render. */}
        <DurationCard workout={w.data} onCorrect={async (endedAt, rev) => {
          const patch = { endedAt, revisions: [...(w.data.revisions ?? []), rev] };
          const ok = await attemptWrite(() => svc.updateWorkout(w.id, patch));
          await reload();
          if (!ok) return;
          setViewWorkout({ ...w, data: { ...w.data, ...patch } });
          showToast({ message: "Session end corrected" });
        }} />
        {/* HOW IT WENT, ON THE SESSION ITSELF (Dave 2026-09-10). These two were
            on the health home page, next to bedtime and bodyweight, which put
            a fact about ONE workout in the place a person writes down facts
            about their day. Rating a session is something you do to a session,
            so it is offered here, on the session -- including weeks later,
            reopened from Recent or History. */}
        {(onRateSession || onLogSoreSpot) && (
          <>
            <div className="sh2 sh2-quiet"><span className="t">How It Went</span></div>
            <div className="pad-x"><div className="card list-card-ruled">
              {onRateSession && (
                <div {...pressable(onRateSession)} className="row">
                  <div className="row-grow">
                    <div className="conn-name">How Hard It Was</div>
                  </div>
                  {CHEV}
                </div>
              )}
              {onLogSoreSpot && (
                <div {...pressable(onLogSoreSpot)} className="row">
                  <div className="row-grow">
                    <div className="conn-name">Where It Hurts</div>
                  </div>
                  {CHEV}
                </div>
              )}
            </div></div>
          </>
        )}
        {/* EDIT A FINISHED WORKOUT (catalog §3.7): tap any set to edit or
            delete it, add one you forgot, all through the same set strip
            that planned and logged it. PRs and the receipt are both derived
            from the workout list at render time, so saving here recomputes
            every number downstream for free. */}
        {/* THE DRAFT IS THE LIST (2026-09-17). This used to map the SAVED
            exercises and read each strip's entries out of the draft by index,
            which was fine while the only edit was to a set -- and is a
            mismatched pair of lists the moment an exercise can be added or
            removed. One list now, so a rename shows as you type it and a
            removed lift leaves rather than leaving a hole behind. */}
        {workoutDraft.map((e, ei) => (
          <div key={e.exerciseId + ei}>
            {/* The one head grammar of the gym pages (reformat 2026-08-31):
                quiet sh2, same as Days / Recent / Exercises. Its overflow is
                the same one every other gym row wears. */}
            <div className="sh2 sh2-quiet">
              <span className="t">{liftTitle(e.name)}</span>
              <button type="button" className="ex-more" aria-label={`More for ${liftTitle(e.name)}`}
                onClick={() => setWorkoutExMenu(ei)}>
                <span aria-hidden="true">···</span>
              </button>
            </div>
            <div className="pad-x">
              <SetStrip
                kind={e.kind}
                unit={e.unit}
                timeUnit={e.timeUnit}
                // The convention these sets were LOGGED under, which the
                // record carries (WorkoutExercise.equipment/counted). An
                // editor that stepped a stack by 5 and called its number
                // "Weight" was correcting history in the wrong language.
                style={loadStyleOf(e)}
                entries={e.sets}
                onChange={(sets) => patchDraft((d) => d.map((x, i) => (i === ei ? { ...x, sets } : x)))}
                moveTracking
              />
            </div>
          </div>
        ))}
        {/* A LIFT YOU FORGOT TO LOG (Dave 2026-09-17). Same .row-create the
            program day and the live session spend on their own adds. */}
        <div className="pad-x"><div className="card list-card-ruled">
          <button className="row-create" onClick={() => setWorkoutAddOpen(true)}>Add Exercise</button>
        </div></div>
        <div className="pad-x sheet-actions">
          {dirty && (
            <button className="btn btn-primary btn-launch btn-block" onClick={async () => {
              // GYM-F-18: the toast fires only once the write resolved, and a
              // failed edit keeps the sheet open on the athlete's own numbers
              // instead of closing over a change that never landed.
              const ok = await attemptWrite(() => svc.updateWorkout(w.id, { exercises: workoutDraft }));
              await reload();
              if (!ok) return;
              showToast({ message: "Workout updated" });
              closeWorkout();
            }}>Save Changes</button>
          )}
          {/* Delete with Undo (2026-08-09): PRs and history derive from the
              workout list, so removing a mislogged session heals every number
              downstream. Same toast contract as every delete in the app. */}
          <button className="btn btn-danger btn-block" onClick={async () => {
            const gone = { ...w.data };
            const ok = await attemptWrite(() => svc.removeWorkout(w.id));
            await reload();
            if (!ok) return;
            closeWorkout();
            showToast({
              message: "Workout deleted",
              actionLabel: "Undo",
              // GYM-F-18: the Undo could throw as silently as the delete did,
              // which is the worst of the two: the session is gone and the
              // athlete believes they got it back.
              onAction: async () => { await attemptWrite(() => svc.saveWorkout(gone)); await reload(); },
            });
          }}>Delete Workout</button>
        </div>
        <div className="screen-foot" />

        {workoutMetaOpen && (
          <WorkoutMetaSheet initialName={w.data.dayName} initialDate={w.data.date}
            onSave={(next) => void saveWorkoutMeta(next)} onCancel={() => setWorkoutMetaOpen(false)} />
        )}

        {/* ONE EXERCISE'S OWN MENU. Both moves land in the draft, so Save
            Changes is still the one write and Cancel is still backing out of
            the screen -- a removal that wrote straight through would be the
            only destructive edit here with no way back. */}
        {workoutExMenu !== null && workoutDraft[workoutExMenu] && (
          <ActionSheet
            title={liftTitle(workoutDraft[workoutExMenu]!.name)}
            actions={[
              { label: "Rename", onClick: () => { setWorkoutExRename(workoutExMenu); setWorkoutExMenu(null); } },
              {
                // Not "Delete...": it lands in the draft, so backing out of
                // the screen without saving is the way out. The armed confirm
                // belongs to writes that land immediately.
                label: "Remove From This Workout",
                onClick: () => {
                  const i = workoutExMenu;
                  patchDraft((d) => d.filter((_, x) => x !== i));
                  setWorkoutExMenu(null);
                },
              },
            ]}
            onClose={() => setWorkoutExMenu(null)}
          />
        )}

        {workoutExRename !== null && workoutDraft[workoutExRename] && (
          <NameSheet
            title="Rename in This Workout"
            initial={liftTitle(workoutDraft[workoutExRename]!.name)}
            placeholder="Exercise Name"
            onSave={(v) => {
              const i = workoutExRename;
              // liftTitle, not workoutTitle: this is a lift's name, and the
              // rule about never casing one into a comparison still holds --
              // nothing here compares it, the draft is written whole.
              patchDraft((d) => d.map((x, k) => (k === i ? { ...x, name: liftTitle(v) } : x)));
              setWorkoutExRename(null);
            }}
            onCancel={() => setWorkoutExRename(null)}
          />
        )}

        {/* A LIFT SOMEBODY FORGOT TO LOG. It arrives with no sets, which is
            the honest state: the sheet plans, and the strip below records
            what was actually done. Its plan rides along as the ghost targets
            the strip offers, exactly as a mid-session add does. */}
        {workoutAddOpen && (
          <ExerciseSheet
            mode="new"
            library={library}
            history={workouts}
            onSave={(draft) => {
              patchDraft((d) => [...d, {
                exerciseId: `add${Date.now().toString(36)}`,
                name: draft.name, kind: draft.kind,
                ...(draft.unit ? { unit: draft.unit } : {}),
                ...(draft.timeUnit ? { timeUnit: draft.timeUnit } : {}),
                ...(draft.exerciseKey ? { exerciseKey: draft.exerciseKey } : {}),
                ...loadFields(draft),
                sets: draft.sets, custom: true, plan: draft.sets,
              }]);
              seedLibrary(draft);
              setWorkoutAddOpen(false);
            }}
            onCancel={() => setWorkoutAddOpen(false)}
          />
        )}
      </div>
    );
  }
  if (live) {
    const day = program ? findDay(program.data.weeks, live.dayId) : undefined;
    // AN OPEN SESSION HAS TO OPEN ON SOMETHING (2026-09-12). The scratch day
    // starts a session with no exercises on purpose, "one the athlete fills
    // with Add Exercise" -- but that control lives inside SessionScreen, which
    // cannot render without a current exercise, so the gym drew an empty screen
    // with no nav bar and no button, and isStillActive kept that session for
    // the rest of the day: every later visit landed on the same dead end.
    //
    // So the empty session opens the same ExerciseSheet the Add Exercise button
    // opens. Save and it is a session like any other. Cancel and the empty
    // session is discarded rather than left behind, which is what Open Session
    // meant in the first place: the sheet IS the screen until there is a lift.
    if (live.exercises.length === 0) {
      return (
        <ExerciseSheet
          mode="new"
          library={library}
          history={workouts}
          onSave={(draft) => {
            // ...loadFields (2026-09-17): this path was missing it while the
            // other mid-session add had it, so a lift that opened an empty
            // session arrived with no equipment and no counting. The strip
            // then stepped it by 5 for everything in the gym and the live
            // card read "Equipment Not Set" on a lift that had just been
            // told what it loads with, two screens earlier.
            patchLive((l) => addExerciseMidSession(l, { exerciseKey: draft.exerciseKey, name: draft.name, kind: draft.kind, unit: draft.unit, timeUnit: draft.timeUnit, ...loadFields(draft), plan: draft.sets, cond: draft.cond, restSec: draft.restSec, ramp: draft.ramp, muscleGroup: draft.muscleGroup, note: draft.note }));
            seedLibrary(draft);
          }}
          onCancel={() => { clearLive(); enterSession(null); }}
        />
      );
    }
    const liveEx = live.exercises[live.idx];
    const planned = day?.exercises[live.idx];
    // SWAP / ADD MID-SESSION / SAME AS LAST TIME (catalog §3.9, §3.10,
    // §3.13): a `custom` entry carries its own identity and plan rather than
    // reading the program day's own exercise at this index.
    //
    // GYM-F-08 (2026-09-05): Same as Last Time also marks every entry custom,
    // to carry last session's numbers as the ghosts, but those entries DO
    // have a program exercise behind them. Rebuilding the exercise from the
    // live entry alone threw away the rest target, the warm-up ramp, the
    // A1/A2 pairing, the note and the conditioning clock on every one of
    // them. Only a swapped or added entry, which has no program exercise at
    // all, takes the bare path now.
    const behind = liveEx ? programExerciseFor(liveEx, day) : undefined;
    // THE LIVE ENTRY'S OWN READING WINS (2026-09-16). The session's Equipment
    // sheet writes here first and to the program second, and for a swapped or
    // added lift the program write never happens at all -- so a base that only
    // ever read the program would answer with the convention the athlete just
    // replaced, or with none. Undefined fields are dropped rather than
    // spread, or an entry that predates the sheet would erase what its
    // program exercise says.
    const liveLoad = liveEx ? {
      ...(liveEx.equipment ? { equipment: liveEx.equipment } : {}),
      ...(liveEx.counted ? { counted: liveEx.counted } : {}),
      ...(liveEx.sided ? { sided: true as const } : {}),
    } : {};
    const withLoad = (ex: Exercise | undefined): Exercise | undefined => (ex ? { ...ex, ...liveLoad } : undefined);
    const exercise: Exercise | undefined = withLoad(liveEx?.custom
      ? (behind
        ? { ...behind, sets: liveEx.plan ?? [] }
        // GYM-F-21 (2026-09-05): an added exercise has no program exercise
        // to read from, so it carries its own clock, rest target, ramp, note
        // and muscle on the entry itself.
        : { id: liveEx.exerciseId, name: liveEx.name, kind: liveEx.kind, unit: liveEx.unit, timeUnit: liveEx.timeUnit, exerciseKey: liveEx.exerciseKey, sets: liveEx.plan ?? [], ...(liveEx.program ?? {}) })
      // 2026-09-11: by id first, never by slot. `planned` is the day's
      // exercise at this INDEX, so reordering or deleting the day's list
      // mid-session showed one lift while the sets were written into another:
      // the saved workout said Rows with curl numbers, and the PR went to
      // Rows. programExerciseFor is the same id match the custom path uses.
      : (() => {
          // O3a: the strip the session started with, not the program's as it
          // stands now; everything else (rest, ramp, group, note, clock)
          // still reads live off the program exercise.
          const base = behind ?? planned;
          if (base) return liveEx?.plan ? { ...base, sets: liveEx.plan } : base;
          return liveEx ? { id: liveEx.exerciseId, name: liveEx.name, kind: liveEx.kind, unit: liveEx.unit, timeUnit: liveEx.timeUnit, sets: [] } : undefined;
        })());
    if (!exercise) return <div className="screen ruled health-ruled" />;
    return (
      <>
      <SessionScreen
        live={live}
        exercise={exercise}
        // The session builds its own list from these (liveGroups.sessionExercises,
        // 2026-09-26), so a swapped or added lift no longer hides every pair
        // on the day by being handed an empty one.
        dayExercises={day?.exercises ?? []}
        programDay={day ?? null}
        history={workouts}
        library={library}
        // Part 3 wave 4 (Dave 14a): one typed count per logged set, nothing
        // about the set itself.
        onLog={(s: SetEntry) => { patchLive((l) => logSet(l, l.idx, s)); emit({ type: "health.logged", props: { kind: "set_logged" } }); }}
        onSetLogged={(sets: SetEntry[], at?: number) => patchLive((l) => setLoggedSets(l, at ?? l.idx, sets))}
        onSkip={() => patchLive((l) => ({ ...skipExercise(l, l.idx), idx: Math.min(l.idx + 1, l.exercises.length - 1) }))}
        onMove={(i) => patchLive((l) => ({ ...l, idx: i }))}
        // A free-text swap mints a lift the library has never seen, same as
        // an add does, so it is seeded the same way.
        onSwap={(sub) => { patchLive((l) => swapExercise(l, l.idx, sub)); seedLibrary(sub); showToast({ message: lineCase(`Swapped in ${liftTitle(sub.name)}`) }); }}
        onSetLoad={(next) => { void setLoadStyle(exercise, next); }}
        {...(() => {
          // SUPERSET WHILE LOGGING (Dave, 2026-09-21: "I can't easily create
          // a superset as I'm logging"; 2026-09-26: "Superset linking between
          // exercises is broken and hard to use"). ONE LINE, ONE WRITE: the
          // session's More sheet offers "Superset With <the next lift>", and
          // it pairs the two for THIS session (live.groups, keyed by the
          // session's own exerciseIds). The program is touched only by the
          // separate "Keep the Superset in the Program" line, the way a swap
          // reaches the program only through Also Update the Program, so
          // editing a program from a workout screen is never a surprise.
          const w = day ? program?.data.weeks.find((x) => x.days.some((d) => d.id === day.id)) : undefined;
          return {
            onGroupToday: (ids: string[], partnerName: string) => {
              const before = liveRef.current?.groups;
              patchLive((l) => ({ ...l, groups: groupForToday(l.groups, ids, () => nid("g")) }));
              showToast({
                message: lineCase(`Superset with ${liftTitle(partnerName)} for today`),
                actionLabel: "Undo",
                onAction: () => patchLive((l) => ({ ...l, groups: before })),
              });
            },
            // AND THE WAY BACK OUT (2026-09-21; scoped 2026-09-26). Today's
            // own pair is simply released. A pair the PROGRAM owns is asked
            // the same two questions as making one: for today, which marks
            // it "" in the session's overlay and leaves next week alone, or
            // for every one of this day, which is the program editor's own
            // Ungroup. Both carry Undo, and the toast says which happened.
            onUngroup: (scope: "today" | "program") => {
              const before = liveRef.current?.groups;
              if (scope === "today" || !w || !day) {
                patchLive((l) => ({ ...l, groups: ungroupToday(l.groups, exercise.id, day?.exercises ?? []) }));
                showToast({
                  message: "Broken Up for Today",
                  actionLabel: "Undo",
                  onAction: () => patchLive((l) => ({ ...l, groups: before })),
                });
                return;
              }
              const others = groupOf(exercise, day.exercises).filter((e) => e.id !== exercise.id).map((e) => e.id);
              void ungroupAction(w.id, day.id, exercise.id).then(() => {
                patchLive((l) => ({ ...l, groups: ungroupToday(l.groups, exercise.id) }));
                showToast({
                  message: lineCase(`Broken up in every ${workoutTitle(day.name)}`),
                  actionLabel: "Undo",
                  onAction: () => { if (others.length) void groupAction(w.id, day.id, exercise.id, others); },
                });
              });
            },
            // "EVERY PUSH DAY": the one program write for a pair made at the
            // rack, through the day's own groupAction (its toast carries the
            // Undo). Offered by the session only when both lifts are on the day.
            ...(w && day ? {
              onGroupProgram: (ids: string[]) => {
                const onDay = ids.filter((id) => id !== exercise.id && day.exercises.some((e) => e.id === id));
                if (onDay.length === 0) return;
                void groupAction(w.id, day.id, exercise.id, onDay);
              },
            } : {}),
          };
        })()}
        // THREE PLACES, NOT ONE (Dave 2026-09-17: "it doesn't save... doesn't
        // allow me to pair... doesn't add to my exercise list").
        //
        // The live session, always -- that is the set you are about to do.
        // The program day, when the sheet's switch says so, because a pair is
        // a program construct the live screen reads off the day, so a lift
        // that is not on the day can never be paired with anything.
        // And the library, always, so the exercise is there to classify and
        // set a goal on before the workout is even finished.
        onAddMidSession={(draft, alsoOnDay) => {
          patchLive((l) => addExerciseMidSession(l, { exerciseKey: draft.exerciseKey, name: draft.name, kind: draft.kind, unit: draft.unit, timeUnit: draft.timeUnit, ...loadFields(draft), plan: draft.sets, cond: draft.cond, restSec: draft.restSec, ramp: draft.ramp, muscleGroup: draft.muscleGroup, note: draft.note }));
          seedLibrary(draft);
          const week = alsoOnDay && day ? program?.data.weeks.find((w) => w.days.some((d) => d.id === day.id)) : undefined;
          if (week && day) {
            void saveDays(week.id, week.days.map((d) => (d.id === day.id ? { ...d, exercises: [...d.exercises, { ...draft, id: nid("e") }] } : d)))
              .then((ok) => showToast({ message: ok ? `${draft.name} added to ${workoutTitle(day.name)}` : `Added ${draft.name} for this session` }));
          } else {
            showToast({ message: `Added ${draft.name}` });
          }
        }}
        onAcceptSuggestion={(sug) => { void acceptSuggestion(exercise, sug); }}
        // Part 3 wave 5 (Dave's 10a): only a swapped or added entry offers it.
        // AND ONLY UNTIL IT IS THERE (2026-09-26): an added lift the day now
        // holds (by key, or by name and kind) is not offered again, since a
        // second tap used to add a second copy.
        onUpdateProgram={liveEx?.custom && !live.sameAsLastTime && day && (behind || !day.exercises.some((e) => (liveEx.exerciseKey && e.exerciseKey === liveEx.exerciseKey) || (e.name.trim().toLowerCase() === liveEx.name.trim().toLowerCase() && e.kind === liveEx.kind))) ? () => {
          const week = program?.data.weeks.find((w) => w.days.some((d) => d.id === day.id));
          if (!week) return;
          const next = dayWithSessionEntry(day, liveEx, () => nid("e"));
          void saveDays(week.id, week.days.map((d) => (d.id === day.id ? next : d))).then((ok) => { if (ok) showToast({ message: `${liveEx.name} is in the program now` }); });
        } : undefined}
        onFit={(patch) => patchLive((l) => ({ ...l, ...patch }))}
        onAdjustTime={() => setAdjustOpen(true)}
        onFinish={() => void finish()}
        onBack={parkSession}
        onPause={parkSession}
        restNotify={restNotify}
        celebrations={celebrations}
        gameLine={gameLine}
      />
      {receiptEl}
      {dupEl}
      {adjustOpen && (
        // The minutes left from now become the session's budget, so the
        // catch-up banner prices the levers against it (D5-C); No Cap lifts
        // the budget. The plan itself is never edited.
        <ActionSheet
          title="How Much Time Is Left"
          actions={[
            ...[10, 20, 30].map((n) => ({ label: capAfterNumber(`${n} min`), onClick: () => patchLive((l) => ({ ...l, budgetMin: Math.max(1, Math.round(elapsedMs(l) / 60_000) + n) })) })),
            { label: "No Cap", onClick: () => patchLive((l) => { const { budgetMin: _gone, ...rest } = l; return rest as LiveSession; }) },
          ]}
          onClose={() => setAdjustOpen(false)}
        />
      )}
      {/* THE SESSION RENDERS ITS OWN PICKERS (2026-09-21). This branch
          returns early, before the shell that carries pickerEl() everywhere
          else, so Superset With... opened a picker that had nowhere to be
          drawn -- the button worked, the state was set, and nothing appeared.
          Caught by driving it, not by a type or a test. */}
      {pickerEl()}
      </>
    );
  }

  const recent = [...workouts].reverse().slice(0, 5);
  // 2026-09-14: the weekday of a day's last session, when it was this week
  // or last (older than that a weekday name says nothing).
  const doneWordFor = (dayId: string): string | null => {
    const last = lastWorkoutForDay(dayId);
    if (!last) return null;
    const days = (new Date(todayISO() + "T00:00:00").getTime() - new Date(last.data.date + "T00:00:00").getTime()) / 86_400_000;
    if (days < 0 || days > 7) return null;
    const dow = (new Date(last.data.date + "T00:00:00").getDay() + 6) % 7;
    return WEEKDAY_ABBR[dow] ?? null;
  };

  // "Next: X" only when there is one week (the common, migrated case): which
  // day comes next across a multi-week block is a real product decision the
  // catalog itself leaves open (PART 8, Q3), so it is not guessed at here.
  const singleWeek = !multiWeek ? weeks[0] ?? null : null;
  // PINS, D4 (Training Catalog V2, approved 2026-08-31): "Up Next follows
  // the pins; unpinned programs keep the current rotation." A day pinned to
  // today wins outright; a program with pins but none today offers the
  // soonest pinned day; a program with no pins at all keeps rotating.
  const pinnedToday = singleWeek ? pinnedTo(singleWeek.days, todayDow()) : null;
  const upcomingPin = singleWeek && !pinnedToday ? nextPinnedDay(singleWeek.days, todayDow()) : null;
  // One derivation, shared with the Health page's hero (gym/nextDay.ts).
  const nextDay = nextDayFor(program, workouts, todayDow())?.day ?? null;
  const nextEst = nextDay ? estimateDay(nextDay, workouts, rackFrom(readGymSettings())).min : 0;
  // THIS day's last session, not the newest of any day. See the Up Next card.
  const lastNextDay = nextDay ? lastWorkoutForDay(nextDay.id) : null;

  function sheetEl() {
    if (sheet.kind === "closed") return null;
    if (sheet.kind === "program") {
      // `programId` present means editing that exact program; absent always
      // means a brand-new one, even while a program is active (see
      // openProgramSheet).
      const target = sheet.programId ? allPrograms.find((p) => p.id === sheet.programId) : undefined;
      return (
        <NameSheet
          title={target ? "Edit Program" : "New Program"}
          initial={target?.data.name}
          placeholder="e.g. Push Pull Legs, Summer Speed"
          season={target ? { inSeason: !!target.data.inSeason, onChangeInSeason: setProgramSeasonDraft } : undefined}
          gameCategory={target ? { categories, value: programGameCategoryDraft, onChange: setProgramGameCategoryDraft } : undefined}
          onSave={async (name) => {
            setSheet({ kind: "closed" });
            await attemptWrite(async () => {
              if (target) await svc.updateProgram(target.id, { name, inSeason: programSeasonDraft, gameCategoryId: programSeasonDraft ? programGameCategoryDraft : undefined });
              else await svc.createProgram({ name, weeks: [{ id: nid("w"), label: "Week 1", days: [] }] });
            });
            await reload();
          }}
          onDelete={target ? async () => {
            setSheet({ kind: "closed" });
            await attemptWrite(() => svc.removeProgram(target.id));
            await reload();
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    if (!program) return null;
    if (sheet.kind === "week") {
      const existing = sheet.weekId ? program.data.weeks.find((w) => w.id === sheet.weekId) : undefined;
      return (
        <NameSheet
          title={existing ? "Edit Week" : "New Week"}
          initial={existing?.label}
          placeholder="e.g. Week 1, Base Week"
          backOff={{ value: weekBackOffDraft, onChange: setWeekBackOffDraft }}
          onSave={async (label) => {
            const nextWeeks = existing
              ? program.data.weeks.map((w) => (w.id === existing.id ? { ...w, label, ...(weekBackOffDraft ? { backOff: true } : { backOff: false }) } : w))
              : [...program.data.weeks, { id: nid("w"), label, days: [], ...(weekBackOffDraft ? { backOff: true } : {}) }];
            setSheet({ kind: "closed" });
            await saveWeeks(nextWeeks);
          }}
          onDelete={existing && program.data.weeks.length > 1 ? async () => {
            setSheet({ kind: "closed" });
            if (openWeekId === existing.id) setOpenWeekId(null);
            await saveWeeks(program.data.weeks.filter((w) => w.id !== existing.id));
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    if (sheet.kind === "bump") {
      const src = program.data.weeks.find((w) => w.id === sheet.weekId);
      if (!src) return null;
      return (
        <BumpSheet
          weekLabel={src.label}
          onSave={async (bump, backOff) => {
            // GYM-F-05 (2026-09-05): the bumped week is a full day copy now
            // (pins, warm-up and cool-down blocks, A1/A2 pairs remapped onto
            // the new ids), then the strips are bumped on top of it. It used
            // to rebuild each day from id/name/exercises, so every copy of
            // last week arrived stripped of all three.
            const days: ProgramDay[] = src.days.map((d) => {
              const copy = duplicateDayFresh(d, true);
              return { ...copy, exercises: copy.exercises.map((e): Exercise => ({ ...e, sets: bumpStrip(e.kind, e.sets, bump) })) };
            });
            const week: ProgramWeek = {
              id: nid("w"), label: `Week ${program.data.weeks.length + 1}`, days,
              ...(backOff ? { backOff: true } : {}),
            };
            setSheet({ kind: "closed" });
            if (await saveWeeks([...program.data.weeks, week])) {
              showToast({ message: `${week.label} added · Duplicated from ${src.label}` });
            }
          }}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    if (sheet.kind === "day") {
      const week = program.data.weeks.find((w) => w.id === sheet.weekId);
      const existing = week && sheet.dayId ? week.days.find((d) => d.id === sheet.dayId) : undefined;
      return (
        <NameSheet
          title={existing ? "Edit Day" : "New Day"}
          initial={existing?.name}
          placeholder="e.g. Pull, Speed Work, Tuesday"
          onSave={async (name) => {
            if (!week) return;
            const days = existing
              ? week.days.map((d) => (d.id === existing.id ? { ...d, name } : d))
              : [...week.days, { id: nid("d"), name, exercises: [] }];
            setSheet({ kind: "closed" });
            await saveDays(week.id, days);
          }}
          onDelete={existing ? async () => {
            if (!week) return;
            setSheet({ kind: "closed" });
            if (openDayId === existing.id) setOpenDayId(null);
            await saveDays(week.id, week.days.filter((d) => d.id !== existing.id));
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    if (sheet.kind === "block") {
      const week = program.data.weeks.find((w) => w.id === sheet.weekId);
      const day = week?.days.find((d) => d.id === sheet.dayId);
      if (!week || !day) return null;
      const warm = sheet.which === "warmUp";
      return (
        <BlockSheet
          title={warm ? "Warm-Up" : "Cool-Down"}
          blocks={(warm ? day.warmUp : day.coolDown) ?? []}
          minutes={(warm ? day.warmUpMin : day.coolDownMin) ?? (warm ? 8 : 5)}
          onSave={async (blocks, minutes) => {
            const days = week.days.map((d) => {
              if (d.id !== day.id) return d;
              const next = { ...d };
              if (warm) {
                if (blocks.length) { next.warmUp = blocks; next.warmUpMin = minutes; }
                else { delete next.warmUp; delete next.warmUpMin; }
              } else if (blocks.length) { next.coolDown = blocks; next.coolDownMin = minutes; }
              else { delete next.coolDown; delete next.coolDownMin; }
              return next;
            });
            setSheet({ kind: "closed" });
            await saveDays(week.id, days);
          }}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    if (sheet.kind === "fillDay") {
      const week = program.data.weeks.find((w) => w.id === sheet.weekId);
      const day = week?.days.find((d) => d.id === sheet.dayId);
      return (
        <LibraryPickSheet
          title={day ? `Add to ${day.name}` : "Add to the Day"}
          library={library}
          onPick={() => {}}
          onPickMany={async (entries: LibraryEntry[]) => {
            if (!week || !day) return;
            // Each pick lands as a real planned exercise carrying everything
            // the library knows about it -- its measure, its unit, its last
            // strip and, above all, its exerciseKey, so a lift added this way
            // shares the history it already had rather than starting a fork.
            // 2026-09-14: the CLASSIFICATION comes with it too -- the declared
            // measurement, the equipment and the reading -- which is what makes
            // editing those in the library a real answer rather than a label.
            // It applies to this NEW sighting only; nothing already logged is
            // touched (classify.ts's first rule).
            const added: Exercise[] = entries.map((e) => {
              const c = classStore[e.key] ?? classStore[e.exerciseKey ?? ""] ?? null;
              const kind = c?.measure ?? e.kind;
              return {
                id: nid("e"),
                name: e.name,
                kind,
                // A declared measure the entry was not logged under brings its
                // own default unit: the old unit could be yards on a kind that
                // measures seconds, and a mismatched unit is a nonsense PR.
                ...(kind === e.kind ? (e.unit ? { unit: e.unit } : {}) : (defaultUnit(kind) ? { unit: defaultUnit(kind)! } : {})),
                ...(kind === e.kind && e.timeUnit ? { timeUnit: e.timeUnit } : {}),
                ...(c?.equipment ? { equipment: c.equipment } : e.equipment ? { equipment: e.equipment as Exercise["equipment"] } : {}),
                ...(c?.counted ? { counted: c.counted } : e.counted ? { counted: e.counted } : {}),
                exerciseKey: e.exerciseKey ?? newExerciseKey(),
                sets: kind === e.kind && e.lastSets.length > 0
                  ? e.lastSets.map((s, i) => ({ ...s, id: `${nid("s")}${i}` }))
                  : uniformStrip(3, { r: 8 }),
              };
            });
            const days = week.days.map((d) => (d.id === day.id ? { ...d, exercises: [...d.exercises, ...added] } : d));
            setSheet({ kind: "closed" });
            // The toast is gated on the write landing: saveDays reports
            // whether it did, and a failed save that says "Added 6 lifts"
            // is the worst version of this feature.
            if (await saveDays(week.id, days)) {
              showToast({ message: added.length === 1 ? `Added ${added[0]!.name}` : `Added ${added.length} lifts` });
            }
          }}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    if (sheet.kind === "exercise") {
      const week = program.data.weeks.find((w) => w.id === sheet.weekId);
      const day = week?.days.find((d) => d.id === sheet.dayId);
      const existing = sheet.exId ? day?.exercises.find((e) => e.id === sheet.exId) : undefined;
      // H-24: the partner names, and the door to Group With, only for an
      // exercise that exists on a day with something else to pair.
      const mates = existing && day ? groupOf(existing, day.exercises).filter((e) => e.id !== existing.id).map((e) => e.name) : [];
      const canPair = !!existing && !!day && day.exercises.length > 1;
      return (
        <ExerciseSheet
          mode={existing ? "edit" : "new"}
          initial={existing}
          library={library}
          history={workouts}
          partner={mates.length ? mates.join(", ") : null}
          onPairWith={canPair ? () => { setSheet({ kind: "closed" }); setPicker({ kind: "groupWith", weekId: sheet.weekId, dayId: sheet.dayId, exId: existing!.id }); } : undefined}
          onSave={async (draft) => {
            if (!week || !day) return;
            const days = week.days.map((d) => {
              if (d.id !== day.id) return d;
              const exercises = existing
                ? d.exercises.map((e) => (e.id === existing.id ? applyExerciseEdit(existing, draft) : e))
                : [...d.exercises, { ...draft, id: nid("e") }];
              return { ...d, exercises };
            });
            setSheet({ kind: "closed" });
            await saveDays(week.id, days);
          }}
          onDelete={existing ? async () => {
            if (!week || !day) return;
            const days = week.days.map((d) => (d.id === day.id ? { ...d, exercises: d.exercises.filter((e) => e.id !== existing.id) } : d));
            setSheet({ kind: "closed" });
            await saveDays(week.id, days);
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    return null;
  }

  function rowMenuEl() {
    if (!rowMenu) return null;
    if (rowMenu.kind === "day") {
      const { weekId, day } = rowMenu;
      const actions: SheetAction[] = [
        { label: "Pin Days...", onClick: () => setPicker({ kind: "pinDays", weekId, day }) },
        { label: "Duplicate", onClick: () => void duplicateDayAction(weekId, day.id) },
      ];
      if (programs.filter((p) => p.id !== program?.id).length > 0) {
        actions.push({ label: "Move to Another Program", onClick: () => setPicker({ kind: "moveDayProgram", weekId, day }) });
      }
      actions.push({ label: "Delete...", onClick: () => setSheet({ kind: "day", weekId, dayId: day.id }) });
      return <ActionSheet title={day.name} actions={actions} onClose={() => setRowMenu(null)} />;
    }
    if (rowMenu.kind === "exercise") {
      const { weekId, dayId, exercise } = rowMenu;
      const otherDays = (program?.data.weeks.find((w) => w.id === weekId)?.days ?? []).filter((d) => d.id !== dayId);
      const actions: SheetAction[] = [
        { label: "Duplicate", onClick: () => void duplicateExerciseAction(weekId, dayId, exercise.id) },
      ];
      if (otherDays.length > 0) {
        actions.push({ label: "Move to Another Day", onClick: () => setPicker({ kind: "moveExerciseToDay", weekId, dayId, exId: exercise.id }) });
        actions.push({ label: "Copy to Other Days", onClick: () => setPicker({ kind: "copyExerciseToDays", weekId, dayId, exId: exercise.id }) });
      }
      const dayExercises = program?.data.weeks.find((w) => w.id === weekId)?.days.find((d) => d.id === dayId)?.exercises ?? [];
      if (dayExercises.length > 1) {
        if (groupOf(exercise, dayExercises).length > 1) {
          actions.push({ label: "Ungroup", onClick: () => void ungroupAction(weekId, dayId, exercise.id) });
        } else {
          // SAME WORD IN BOTH PLACES (2026-09-21). The live session has said
          // "Superset With..." since it was built; the program editor said
          // "Group With...", which is the data model's word and not the
          // athlete's. One name, in the one vocabulary the athlete uses.
          actions.push({ label: "Superset With...", onClick: () => setPicker({ kind: "groupWith", weekId, dayId, exId: exercise.id }) });
        }
      }
      actions.push({ label: "Delete...", onClick: () => setSheet({ kind: "exercise", weekId, dayId, exId: exercise.id }) });
      return <ActionSheet title={liftTitle(exercise.name)} actions={actions} onClose={() => setRowMenu(null)} />;
    }
    if (rowMenu.kind === "program") {
      const p = rowMenu.program;
      const actions: SheetAction[] = [
        { label: "Duplicate", onClick: () => void duplicateProgramAction(p) },
        p.data.archived
          ? { label: "Restore from Archive", onClick: () => void archiveProgramAction(p, false) }
          : { label: "Archive", onClick: () => void archiveProgramAction(p, true) },
      ];
      return <ActionSheet title={p.data.name} actions={actions} onClose={() => setRowMenu(null)} />;
    }
    return null;
  }

  function fitEl() {
    if (!fitFor) return null;
    return (
      <FitSheet
        day={fitFor.day}
        history={workouts}
        rack={rackFrom(readGymSettings())}
        defaultBudgetMin={fitFor.budgetMin}
        onStart={(fit) => { const f = fitFor; setFitFor(null); startDay(f.day, { fit, doorEventId: f.doorEventId }); }}
        onCancel={() => setFitFor(null)}
        gameLine={gameLine}
      />
    );
  }

  function doorPickEl() {
    if (!doorPick || !door || !program) return null;
    const days = program.data.weeks.flatMap((w) => w.days).filter((d) => d.exercises.length > 0);
    return (
      <PickSheet
        title="Which Day Is This"
        items={days.map((d) => ({ id: d.id, label: d.name, sub: `${d.exercises.length} ${d.exercises.length === 1 ? "exercise" : "exercises"}` }))}
        emptyText="No days with exercises yet, build one first"
        onPick={(ids) => {
          const d = days.find((x) => x.id === ids[0]);
          setDoorPick(false);
          if (d) requestStart(d, { doorEventId: door.eventId, budgetMin: door.budgetMin });
        }}
        onCancel={() => setDoorPick(false)}
      />
    );
  }

  function pickerEl() {
    if (!picker) return null;
    if (picker.kind === "moveExerciseToDay" || picker.kind === "copyExerciseToDays") {
      const week = program?.data.weeks.find((w) => w.id === picker.weekId);
      const items: PickItem[] = (week?.days ?? []).filter((d) => d.id !== picker.dayId).map((d) => ({ id: d.id, label: d.name, sub: `${d.exercises.length} ${d.exercises.length === 1 ? "exercise" : "exercises"}` }));
      const multi = picker.kind === "copyExerciseToDays";
      return (
        <PickSheet
          title={multi ? "Copy Exercise To" : "Move Exercise To"}
          items={items}
          multi={multi}
          emptyText="No other days in this week yet."
          onPick={(ids) => {
            setPicker(null);
            if (multi) void copyExerciseAction(picker.dayId, picker.exId, ids);
            else void moveExerciseAction(picker.dayId, picker.exId, ids[0]!);
          }}
          onCancel={() => setPicker(null)}
        />
      );
    }
    if (picker.kind === "groupWith") {
      const week = program?.data.weeks.find((w) => w.id === picker.weekId);
      const day = week?.days.find((d) => d.id === picker.dayId);
      const items: PickItem[] = (day?.exercises ?? []).filter((e) => e.id !== picker.exId).map((e) => ({ id: e.id, label: e.name }));
      return (
        <PickSheet
          title="Superset With"
          items={items}
          multi
          confirmLabel={(n) => (n === 0 ? "Pick at Least One" : n === 1 ? "Make a Pair" : capAfterNumber("Group These " + (n + 1)))}
          onPick={(ids) => { setPicker(null); void groupAction(picker.weekId, picker.dayId, picker.exId, ids); }}
          onCancel={() => setPicker(null)}
        />
      );
    }
    if (picker.kind === "supersetDay") {
      const week = program?.data.weeks.find((w) => w.id === picker.weekId);
      const day = week?.days.find((d) => d.id === picker.dayId);
      const items: PickItem[] = (day?.exercises ?? []).map((e) => ({ id: e.id, label: e.name }));
      return (
        <PickSheet
          title="Superset"
          items={items}
          multi
          // Two is the smallest superset there is, so one pick is not an
          // answer and the button says which half is missing.
          confirmLabel={(n) => (n < 2 ? "Pick Two" : n === 2 ? "Superset These Two" : capAfterNumber("Superset These " + n))}
          onPick={(ids) => {
            if (ids.length < 2) return;
            setPicker(null);
            void groupAction(picker.weekId, picker.dayId, ids[0]!, ids.slice(1));
          }}
          onCancel={() => setPicker(null)}
        />
      );
    }
    if (picker.kind === "pinDays") {
      const { weekId, day } = picker;
      const items: PickItem[] = WEEKDAY_FULL.map((label, i) => ({ id: String(i), label }));
      return (
        <PickSheet
          title={`Pin ${day.name}`}
          items={items}
          multi
          allowEmpty
          initial={(day.pinDays ?? []).map(String)}
          confirmLabel={(count) => (count === 0 ? "No Pins · Keep the Rotation" : "Pin")}
          onPick={(ids) => {
            setPicker(null);
            const pins = ids.map(Number).sort((a, b) => a - b);
            const week = program?.data.weeks.find((w) => w.id === weekId);
            if (!week) return;
            const days = week.days.map((d) => {
              if (d.id !== day.id) return d;
              if (!pins.length) { const { pinDays: _gone, ...rest } = d; return rest as ProgramDay; }
              return { ...d, pinDays: pins };
            });
            void saveDays(weekId, days).then((ok) => {
              if (ok) showToast({ message: pins.length ? `${day.name} pinned · ${pinLabel(pins)}` : `${day.name} unpinned · Rotation decides` });
            });
          }}
          onCancel={() => setPicker(null)}
        />
      );
    }
    if (picker.kind === "moveDayProgram") {
      const items: PickItem[] = programs.filter((p) => p.id !== program?.id).map((p) => ({ id: p.id, label: p.data.name }));
      return (
        <PickSheet
          title="Move Day to Program"
          items={items}
          onPick={(ids) => {
            const targetId = ids[0]!;
            const target = programs.find((p) => p.id === targetId);
            if (!target) { setPicker(null); return; }
            if (target.data.weeks.length <= 1) {
              const weekId = target.data.weeks[0]?.id ?? nid("w");
              setPicker(null);
              void moveDayToProgramAction(picker.weekId, picker.day, targetId, weekId);
            } else {
              setPicker({ kind: "moveDayWeek", targetProgramId: targetId, day: picker.day });
            }
          }}
          onCancel={() => setPicker(null)}
        />
      );
    }
    if (picker.kind === "moveDayWeek") {
      const target = programs.find((p) => p.id === picker.targetProgramId);
      const items: PickItem[] = (target?.data.weeks ?? []).map((w) => ({ id: w.id, label: w.label }));
      return (
        <PickSheet
          title="Which Week"
          items={items}
          onPick={(ids) => {
            setPicker(null);
            // The source week for the day being moved is wherever it still
            // lives -- found by scanning, since this step only knows the day.
            const sourceWeek = program?.data.weeks.find((w) => w.days.some((d) => d.id === picker.day.id));
            if (sourceWeek) void moveDayToProgramAction(sourceWeek.id, picker.day, picker.targetProgramId, ids[0]!);
          }}
          onCancel={() => setPicker(null)}
        />
      );
    }
    return null;
  }

  const switcherEl = switcherOpen ? (
    createPortal(
      <div className="sheet-scrim" onClick={() => setSwitcherOpen(false)}>
        <div className="card" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-handle" />
          <div className="grp"><div className="eyebrow">Programs</div></div>
          <div><div className="list-flat">
            <ReorderList
              ids={programs.map((p) => p.id)}
              onReorder={(ids) => {
                const order = new Map(ids.map((id, i) => [id, i]));
                void attemptWrite(() => Promise.all(programs.map((p) => svc.updateProgram(p.id, { order: order.get(p.id) ?? 0 })))).then(reload);
              }}
              renderRow={(id) => {
                const p = programs.find((x) => x.id === id);
                if (!p) return null;
                return <ProgramRow program={p} active={p.id === program?.id} onSwitch={() => switchProgram(p.id)} onMenu={() => setRowMenu({ kind: "program", program: p })} />;
              }}
            />
            <button className="row-create" onClick={() => { setSwitcherOpen(false); openProgramSheet(); }}>Add Program</button>
          </div></div>
          {allPrograms.some((p) => p.data.archived) && (
            <>
              <div className="grp"><div className="eyebrow">Archived</div></div>
              <div><div className="list-flat">
                {allPrograms.filter((p) => p.data.archived).map((p) => (
                  <ProgramRowStatic key={p.id} program={p} onMenu={() => setRowMenu({ kind: "program", program: p })} />
                ))}
              </div></div>
            </>
          )}
          <div className="pad-x sheet-actions">
            <button className="btn btn-secondary btn-block" onClick={() => setSwitcherOpen(false)}>Close</button>
          </div>
        </div>
      </div>,
      document.body,
    )
  ) : null;

  const backdateEl = backdateDay ? (
    <BackdateSheet
      dayName={backdateDay.name}
      onStart={(date) => { const d = backdateDay; setBackdateDay(null); startDay(d, { date }); }}
      onCancel={() => setBackdateDay(null)}
    />
  ) : null;

  // ---- day detail: the exercises inside one week's day ----
  if (openDayId && activeWeek) {
    const openDay = activeWeek.days.find((d) => d.id === openDayId) ?? null;
    if (openDay) {
      const labels = groupLabels(openDay.exercises);
      const lastForDay = lastWorkoutForDay(openDay.id);
      return (
        <>
          <div className="screen ruled health-ruled">
            <div className="nav-bar">
              <button className="nav-back" aria-label="Back" onClick={() => setOpenDayId(null)}></button>
              <div className="nav-title truncate">{openDay.name}</div>
              <button className="nav-action-text" onClick={() => setSheet({ kind: "day", weekId: activeWeek.id, dayId: openDay.id })}>Edit</button>
            </div>
            {/* THE BLOCKS (D3-C): what readies the body rather than one
                lift. A checklist with its own minutes, skippable as a unit,
                and those minutes count toward what D5 fits against. */}
            <BlockList
              title="Warm-Up"
              blocks={openDay.warmUp}
              minutes={openDay.warmUpMin}
              onEdit={() => setSheet({ kind: "block", weekId: activeWeek.id, dayId: openDay.id, which: "warmUp" })}
            />
            <div className="sh2 sh2-quiet"><span className="t">Exercises</span>
              {openDay.exercises.length > 1 && (
                <span className="sec-left">
                  {/* A SUPERSET IS A THING YOU DO, SO IT IS A BUTTON YOU CAN
                      SEE (Dave, 2026-09-21). It was a long-press menu item
                      called "Group With...", which is a hidden gesture under
                      a word he does not use, and he could not find it: "no
                      superset buttons anywhere in the workout pages". It
                      sits beside Reorder because they are the same kind of
                      move -- both rearrange the day rather than change a
                      lift -- and it is hidden for a day with one exercise
                      in it, which has nothing to pair. */}
                  <button className="see-all pill-action" onClick={() => setPicker({ kind: "supersetDay", weekId: activeWeek.id, dayId: openDay.id })}>
                    Superset
                  </button>
                  <button className="see-all pill-action" onClick={() => setReorderTarget((t) => (t === "exercises" ? null : "exercises"))}>
                    {reorderTarget === "exercises" ? "Done" : "Reorder"}
                  </button>
                </span>
              )}
            </div>
            <div className="pad-x list-card"><div className="card list-card-ruled">
              <ReorderList
                ids={openDay.exercises.map((e) => e.id)}
                onReorder={(ids) => void reorderExercises(activeWeek.id, openDay.id, ids)}
                handles={reorderTarget === "exercises"}
                renderRow={(id) => {
                  const e = openDay.exercises.find((x) => x.id === id);
                  if (!e) return null;
                  return (
                    <ExerciseRow
                      exercise={e}
                      pairLabel={labels.get(e.id)}
                      onOpen={() => setSheet({ kind: "exercise", weekId: activeWeek.id, dayId: openDay.id, exId: e.id })}
                      onMenu={() => setRowMenu({ kind: "exercise", weekId: activeWeek.id, dayId: openDay.id, exercise: e })}
                    />
                  );
                }}
              />
              {/* TWO DOORS (2026-09-14), IN THE OTHER ORDER (Dave, 2026-09-21:
                  "the user should be able to essentially just populate
                  workout days with workout options... It's kind of that way
                  on accident right now").
                  Both doors were already here and the fast one was second, so
                  building a day meant meeting an eleven-field authoring sheet
                  -- name, sets, reps, equipment, reps count, weight, unit,
                  customize, measure, clock, muscle -- once per exercise.
                  Picking from lifts you already have is the common move by a
                  long way, and it is six taps for six lifts, so it leads.
                  Authoring is the escape hatch for something genuinely new,
                  and says so: "New Exercise" rather than "Add Exercise",
                  because next to a picker "Add" described them both.
                  It still hides itself on an empty library, where it would
                  open onto nothing -- and then the authoring door is the only
                  one, which is correct, because there is nothing to pick. */}
              {library.length > 0 && (
                <button className="row-create" onClick={() => setSheet({ kind: "fillDay", weekId: activeWeek.id, dayId: openDay.id })}>Add from Your Lifts</button>
              )}
              <button className="row-create" onClick={() => setSheet({ kind: "exercise", weekId: activeWeek.id, dayId: openDay.id })}>New Exercise</button>
            </div></div>
            {/* 2026-09-14 (the reference's day plan): an edit here reaches the
                next session; a logged session keeps the numbers it logged.
                BEHIND A LABELLED DISCLOSURE since the health polish pass
                (2026-09-16). The handoff moves exactly this line: "Edits apply
                to future workouts. Logged sessions keep their recorded values
                -- moves to About changes disclosure." It is an edit EFFECT,
                which rule 3 puts in a disclosure beside methodology and
                limitations: true, worth stating once, and a permanent grey
                sentence under a list you edit often. The summary names what is
                inside, so nothing is silently removed. */}
            <div className="pad-x"><details className="exp-more">
              <summary>About Changes to This Workout</summary>
              <div className="input-hint">Edits apply to future workouts {"\u00b7"} Logged sessions keep their own numbers</div>
            </details></div>
            {(live ?? parkedLive) && (
              <div className="pad-x">
                <button className="btn btn-secondary btn-block" onClick={() => enterSession(readLive() ?? live ?? parkedLive)}>Return to Current Session</button>
              </div>
            )}
            <BlockList
              title="Cool-Down"
              tone="cool"
              blocks={openDay.coolDown}
              minutes={openDay.coolDownMin}
              onEdit={() => setSheet({ kind: "block", weekId: activeWeek.id, dayId: openDay.id, which: "coolDown" })}
            />
            {/* PINS, D4: where this day lives in the week. The row is the
                editor's door; no pin is a legal, honest state, and the row
                says what it means (rotation keeps its job) rather than
                "None" (§AK, 2026-09-26). */}
            <div className="sh2 sh2-quiet"><span className="t">Schedule</span></div>
            <div className="pad-x"><div className="card list-card-ruled">
              <div className="row" role="button" tabIndex={0} onClick={() => setPicker({ kind: "pinDays", weekId: activeWeek.id, day: openDay })}>
                <div className="row-grow">
                  <div className="conn-name">Pinned Days</div>
                  <div className="conn-meta">{openDay.pinDays?.length ? pinLabel(openDay.pinDays) : "Rotation decides"}</div>
                </div>
                {CHEV}
              </div>
            </div></div>
            {openDay.exercises.length > 0 && (
              <div className="pad-x gym-log">
                <button className="btn btn-primary btn-launch btn-block btn-lg" onClick={() => requestStart(openDay)}>Start {openDay.name}</button>
                {lastForDay && (
                  // SAME AS LAST TIME (catalog §3.13): the fastest possible
                  // entry, pre-filled with what actually happened last time.
                  <button className="row-create row-create-bare" onClick={() => startDay(openDay, { sameAsLastTime: true })}>Same as Last Time</button>
                )}
                {/* LOG IT LATER (catalog §3.8): the phone was in a locker. */}
                <button className="row-create row-create-bare" onClick={() => setBackdateDay(openDay)}>Log a Past Workout</button>
              </div>
            )}
            <div className="screen-foot" />
          </div>
          {sheetEl()}
          {rowMenuEl()}
          {pickerEl()}
              {fitEl()}
          {backdateEl}
          {receiptEl}
        </>
      );
    }
  }

  // ---- week detail: the days inside one week (only reachable when multi-week) ----
  if (multiWeek && openWeekId && activeWeek) {
    return (
      <>
        <div className="screen ruled health-ruled">
          <div className="nav-bar">
            <button className="nav-back" aria-label="Back" onClick={() => setOpenWeekId(null)}></button>
            <div className="nav-title truncate">{activeWeek.label}</div>
            <button className="nav-action-text" onClick={() => openWeekSheet(activeWeek.id)}>Edit</button>
          </div>
          {activeWeek.backOff && (
            <div className="pad-x"><span className="pill pill-subdued">Back-Off Week</span></div>
          )}
          <div className="sh2 sh2-quiet"><span className="t">Days</span>
            {activeWeek.days.length > 1 && (
              <button className="see-all pill-action" onClick={() => setReorderTarget((t) => (t === "days" ? null : "days"))}>
                {reorderTarget === "days" ? "Done" : "Reorder"}
              </button>
            )}
          </div>
          <div className="pad-x list-card"><div className="card list-card-ruled">
            <ReorderList
              ids={activeWeek.days.map((d) => d.id)}
              onReorder={(ids) => void reorderDays(activeWeek.id, ids)}
              handles={reorderTarget === "days"}
              renderRow={(id) => {
                const d = activeWeek.days.find((x) => x.id === id);
                if (!d) return null;
                return (
                  // SWIPE TO DELETE A DAY (Dave 2026-09-10: "It's way too hard
                  // to delete stuff especially"). Off while the list is in
                  // reorder mode, because two gestures on one row is neither.
                  <SwipeDelete
                    label={d.name}
                    enabled={reorderTarget !== "days"}
                    onDelete={() => void removeDayNow(activeWeek.id, d.id)}
                  >
                    <DayRow
                      day={d}
                      onOpen={() => { setReorderTarget(null); setOpenDayId(d.id); }}
                      onPin={() => setPicker({ kind: "pinDays", weekId: activeWeek.id, day: d })}
                      onMenu={() => setRowMenu({ kind: "day", weekId: activeWeek.id, day: d })}
                    />
                  </SwipeDelete>
                );
              }}
            />
            <button className="row-create" onClick={() => setSheet({ kind: "day", weekId: activeWeek.id })}>Add Day</button>
          </div></div>
          <div className="pad-x">
            <button className="btn btn-secondary btn-block" onClick={() => setSheet({ kind: "bump", weekId: activeWeek.id })}>Duplicate {activeWeek.label} & Bump</button>
          </div>
          <div className="screen-foot" />
        </div>
        {sheetEl()}
        {rowMenuEl()}
        {pickerEl()}
          {fitEl()}
        {receiptEl}
      </>
    );
  }

  return (
    <>
      <div className="screen ruled health-ruled">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={onBack}></button>
          <div className="nav-title truncate">{program ? program.data.name : "Training"}</div>
          {program && <button className="nav-action-text" onClick={() => openProgramSheet(program)}>Edit</button>}
        </div>

        {/* GYM-F-14 (2026-09-05): a session parked with Back used to be
            invisible until the next refresh dragged the athlete back into it.
            It is one tap away instead, and says what is in it. */}
        {parkedLive && (
          <div className="pad-x"><div className="card list-card-ruled">
            <div className="row" role="button" tabIndex={0} onClick={() => enterSession(readLive() ?? parkedLive)}>
              <div className="row-grow">
                <div className="conn-name truncate">Resume {workoutTitle(parkedLive.dayName)}</div>
                {/* A count once there is one; before the first set the row
                    says nothing (§AK: a placeholder is not a fact). */}
                {(() => {
                  const n = parkedLive.exercises.reduce((c, e) => c + e.sets.filter((x) => !x.skipped).length, 0);
                  return n > 0 ? <div className="conn-meta">{`${n} ${n === 1 ? "set" : "sets"} logged`}</div> : null;
                })()}
              </div>
              {CHEV}
            </div>
          </div></div>
        )}

        {!program ? (
          // BROWSER-F-11: with history below it, the empty state is a card at
          // the top of a real page rather than the whole screen.
          <div className={"empty-state" + (recent.length > 0 ? " empty-compact" : "")}>
            <div className="empty-icon">{DUMBBELL}</div>
            <div className="empty-title">No Program Yet</div>
            <button className="btn btn-primary btn-launch" onClick={() => openProgramSheet()}>Create a Program</button>
            {ai.available && <button className="btn btn-secondary" onClick={() => setUploadOpen(true)}>Upload One Instead</button>}
            {/* GYM-F-11 (2026-09-05): archiving your only program landed you
                here, and the switcher (the only place the Archived shelf and
                its Restore live) hung off the Program row, which this branch
                does not render. The way back was to create a throwaway
                program, restore the real one, then delete the throwaway. The
                shelf gets its own door out here whenever there is anything
                on it. */}
            {allPrograms.some((p) => p.data.archived) && (
              <button className="btn btn-secondary" onClick={() => setSwitcherOpen(true)}>Restore an Archived Program</button>
            )}
          </div>
        ) : (
          <>
            {/* ONE SYSTEM ON THIS PAGE (Dave 2026-08-31, 5 Day Program
                screenshot: "Styling is random and doesn't align. Even one
                page has different styled sections."). This page now speaks
                only the app's inset-grouped language -- quiet sh2 head, one
                grouped card per section, row-create for every in-list create,
                eyebrow+title+meta anatomy on the one feature card -- the
                same grammar Today and Tasks already settled on, which is
                itself the Apple Health/Fitness grouped-card language the
                design system was benchmarked against (2026-08-31 research:
                mirror Apple Health; execute with ADA-lineage restraint). */}
            {/* MULTIPLE PROGRAMS & ARCHIVE (catalog §3.11): always reachable,
                even with just one program today, so creating a second one
                and archiving a retired block are never a hunt. The switcher
                is a grouped row like everything else -- it floated bare in
                pad-x before, the page's one row outside any card. THE SEASON
                LINK (catalog §4.7) rides its meta line: strictly a fact,
                never a prescription -- the day a game lands on, nothing
                about what to do with the lift. It floated too. */}
            {/* SAY IT ONCE (health polish 2026-09-16, rule 6: "navigation
                title '5 Day Program' should not be followed by 'PROGRAM' and
                another identically named card"). The nav title IS the
                program's name, so the head said the category and the row
                said the name again: the same words three deep before a
                single fact. The head is gone and the row says what it opens
                -- the switcher's own shelf, whose eyebrow is Programs -- so
                the only thing repeated on this screen is nothing. The row
                itself stays, per catalog §3.11: the switcher and the
                Archived shelf are always reachable. */}
            {/* ONE SHELF, TWO DOORS (Dave 2026-09-17). See LiftsRow. */}
            <div className="pad-x"><div className="card list-card-ruled">
              <div className="row" role="button" tabIndex={0} onClick={() => setSwitcherOpen(true)}>
                <div className="row-grow">
                  <div className="conn-name truncate">All Programs</div>
                  {(programs.length > 1 || program.data.inSeason) && (
                    <div className="facts">
                      {/* §AM (2026-09-26): the count has no state, so it is
                          a white <b>; the game's date is a neutral date, so
                          small caps. "In-Season" keeps the one grey. */}
                      {programs.length > 1 && <span className="fact"><b>{`${programs.length} Active`}</b></span>}
                      {program.data.inSeason && (nextGame
                        ? <span className="fact date">{`Next Game ${monthDay(nextGame.date)}`}</span>
                        : <span className="fact">In-Season</span>)}
                    </div>
                  )}
                </div>
                {CHEV}
              </div>
              {library.length > 0 && <LiftsRow count={library.length} onOpen={() => setLibraryOpen(true)} />}
            </div></div>

            {nextDay && nextDay.exercises.length > 0 && (
              // The launch card wears the offer anatomy the First Step card
              // settled (eyebrow says WHAT the card is; the old "Next: X"
              // folded that into the title).
              // THE TONE MOVES TO THE LABEL (2026-09-16, the polish handoff:
              // "Up Next card has compact count and estimate", and its rule 1
              // against large filled slabs). The whole card wore the blue
              // performance wash, which on a black page is the brightest
              // rectangle on the screen -- louder than the red Start inside
              // it, so the card shouted and its own verb whispered. The
              // eyebrow keeps the blue, which is where the identity was doing
              // real work; the card is the app's own.
              <div className="pad-x"><div className="card pad">
                <div className="eyebrow eyebrow-blue">Up Next</div>
                <div className="conn-name">{nextDay.name}</div>
                {/* D4: when a pin chose this day, the meta says so; D5: the
                    estimate rides along once there is anything to price.

                    LAST TRAINED MEANS THIS DAY (2026-09-16, found proofing the
                    polish pass). It read recent[0] -- the newest workout of
                    ANY day -- so the Up Next card for Push Day 1 said "last
                    trained three days ago" when three days ago was Leg Day.
                    lastWorkoutForDay has answered this correctly since
                    GYM-F-11 and simply was not asked.

                    AND IT IS CHIPS, NOT A CLAUSE (Dave, all pass: "grey
                    subtext all over the place"). Five facts joined by middots
                    in one grey line is the shape every other card on these
                    screens stopped using in September; polish rule 3 asks for
                    one short readable line, and four aligned chips read in a
                    glance where a sentence has to be parsed. */}
                <div className="se-chips">
                  <span className="se-chip se-chip-last">{nextDay.exercises.length}<em>{nextDay.exercises.length === 1 ? "Lift" : "Lifts"}</em></span>
                  {nextEst > 0 && <span className="se-chip se-chip-est"><em>Est</em>{nextEst} Min</span>}
                  {(pinnedToday === nextDay || upcomingPin?.day === nextDay) && (
                    <span className="se-chip se-chip-pin"><em>Pinned</em>{pinnedToday === nextDay
                      ? "Today"
                      : upcomingPin!.inDays === 1 ? "Tomorrow" : WEEKDAY_ABBR[(todayDow() + upcomingPin!.inDays) % 7]}</span>
                  )}
                  {/* Lime, like the weekday on the day rows below it: this is
                      the same fact, so it wears the same colour (2026-09-18). */}
                  {lastNextDay && <span className="se-chip se-chip-done"><em>Last</em>{agoPhrase(lastNextDay.data.date, todayISO())}</span>}
                </div>
                {/* row-tap: the launch card's verb line, filled edge to edge by its one Start button */}
                <div className="offer-row">
                  <button className="btn btn-primary btn-launch btn-block" onClick={() => requestStart(nextDay)}>Start {nextDay.name}</button>
                </div>
              </div></div>
            )}

            {multiWeek ? (
              <>
                <div className="sh2 sh2-quiet"><span className="t">Weeks</span>
                  <button className="see-all" onClick={() => setManageOpen(true)}>Manage</button>
                </div>
                <div className="pad-x"><div className="card list-card-ruled">
                  {weeks.map((w) => (
                    <div className="row" role="button" tabIndex={0} key={w.id} onClick={() => setOpenWeekId(w.id)}>
                      <div className="row-grow">
                        <div className="conn-name truncate">
                          {w.label}
                          {w.backOff && <span className="pill pill-subdued week-back-off">Back-Off</span>}
                        </div>
                        <div className="conn-meta">{w.days.length} {w.days.length === 1 ? "day" : "days"}</div>
                      </div>
                      {CHEV}
                    </div>
                  ))}
                  <button className="row-create" onClick={() => openWeekSheet()}>Add Week</button>
                </div></div>
              </>
            ) : (
              <>
                <div className="sh2 sh2-quiet"><span className="t">Days</span>
                  <span className="sec-left">
                    {singleWeek && singleWeek.days.length > 1 && (
                      <button className="see-all pill-action" onClick={() => setReorderTarget((t) => (t === "days" ? null : "days"))}>
                        {reorderTarget === "days" ? "Done" : "Reorder"}
                      </button>
                    )}
                    <button className="see-all" onClick={() => setManageOpen(true)}>Manage</button>
                  </span>
                </div>
                <div className="pad-x list-card"><div className="card list-card-ruled">
                  {singleWeek && (
                    <ReorderList
                      ids={singleWeek.days.map((d) => d.id)}
                      onReorder={(ids) => void reorderDays(singleWeek.id, ids)}
                      handles={reorderTarget === "days"}
                      renderRow={(id) => {
                        const d = singleWeek.days.find((x) => x.id === id);
                        if (!d) return null;
                        return (
                          <DayRow
                            day={d}
                            doneWord={doneWordFor(d.id)}
                            current={(live ?? parkedLive)?.dayId === d.id}
                            onOpen={() => { setReorderTarget(null); setOpenDayId(d.id); }}
                            onPin={() => setPicker({ kind: "pinDays", weekId: singleWeek.id, day: d })}
                            onMenu={() => setRowMenu({ kind: "day", weekId: singleWeek.id, day: d })}
                          />
                        );
                      }}
                    />
                  )}
                  {/* All three creates wear the ONE in-list create
                      affordance -- .row-create, the approved preview's own
                      full-width red-text card row (THE PREVIEW IS THE SPEC,
                      2026-09-01). The floating .row-act pills were this
                      page's "looks like absolute shit". */}
                  {singleWeek && <button className="row-create" onClick={() => setSheet({ kind: "day", weekId: singleWeek.id })}>Add Day</button>}
                </div></div>
              </>
            )}
          </>
        )}

        {/* BROWSER-F-11 (2026-09-05, fork option A): your history is yours
            whether or not a program exists. Recent and the History pill used
            to live inside the `program` branch, so a store with fourteen
            logged workouts showed "No Program Yet" and nothing else, while
            the Health page above it said "Last session Push Day · Aug 28".
            Creating any program, even an empty one, made them appear. */}
        {/* UP-ATH-21 (2026-09-06): Your Lifts. buildLibrary has known every
            exercise the athlete has ever used since the library shipped and
            nothing rendered it outside an autocomplete, so there was no way
            to see the list, rename one, or fold the duplicates a free-text
            library grows. Offered whenever there is a library to look at. */}
        {/* With a program, this row rides the shelf under All Programs. With
            no program there is no shelf to ride, and a library is still worth
            reaching, so it keeps its own card down here. */}
        {!program && library.length > 0 && (
          <div className="pad-x"><div className="card list-card-ruled">
            <LiftsRow count={library.length} onOpen={() => setLibraryOpen(true)} />
          </div></div>
        )}
        {recent.length > 0 && (
          <>
            {/* NOT A PILL (health polish 2026-09-16, rule 2: "Recent header:
                View history, a text action, no standalone pill"). It wore the
                home-page head pill from the 2026-08-31 count-pill wave, which
                put a capsule round a link that only navigates -- and a capsule
                in this app means a verb that acts on the row it sits in. It is
                the head's own .see-all now, like every other section head, and
                it says the verb rather than repeating the noun beside it. */}
            <div className="sh2 sh2-quiet"><span className="t">Recent</span><button className="see-all" onClick={() => setHistoryOpen(true)}>View History</button></div>
            <div className="pad-x"><div className="card list-card-ruled">
              {recent.map((w) => {
                const logged = w.data.exercises.filter((e) => e.sets.some((s) => !s.skipped)).length;
                const total = w.data.exercises.length;
                return (
                  // Tappable since 2026-08-09: these rows were inert, which
                  // made a mislogged workout permanent. The detail sheet
                  // carries the delete.
                  // ...and to delete a mislogged session, which until now
                  // meant opening it and finding the delete inside (Dave
                  // 2026-09-10).
                  <SwipeDelete key={w.id} label={w.data.dayName} onDelete={() => void removeWorkoutNow(w.id, w.data.dayName)}>
                    <div className="row" role="button" tabIndex={0} onClick={() => { setViewWorkout(w); setWorkoutDraft(w.data.exercises); }}>
                      <div className="row-grow">
                        <div className="conn-name truncate">{workoutTitle(w.data.dayName)}</div>
                        {/* Partial work is stated as the fact it is: never a
                            percentage, never a shortfall. */}
                        {/* Three facts, three chips, aligned -- the date, the
                            minutes, and how much of the plan was actually
                            logged. It was one grey sentence joined by middots
                            and the completeness fact was the last thing on it. */}
                        {/* §AM (2026-09-26): the date is a neutral past date,
                            so small caps rather than Health's "now" cyan; a
                            partial count has no state, so it is a white <b>,
                            and the minutes keep the row's one grey. */}
                        <div className="facts">
                          <span className="fact date">{monthDay(w.data.date)}</span>
                          {minutesFact(w.data)}
                          {logged === total
                            ? <span className="fact lime">{capAfterNumber(`${total} ${total === 1 ? "lift" : "lifts"}`)}</span>
                            : <span className="fact"><b>{`${logged} of ${total}`}</b></span>}
                        </div>
                      </div>
                      {CHEV}
                    </div>
                  </SwipeDelete>
                );
              })}
            </div></div>
          </>
        )}
        <div className="screen-foot" />
      </div>

      {manageOpen && (
        <ActionSheet
          title="Manage Program"
          actions={[
            // GYM-F-17 (2026-09-05): the upload door only ever lived in the
            // single-week Days card, so once a program went multi-week a
            // second coach's sheet had no entry point at all. One door for
            // both layouts is what that fix was reaching for.
            ...(ai.available ? [{ label: "Upload a Program", onClick: () => setUploadOpen(true) }] : []),
            { label: "Add a Week", onClick: () => openWeekSheet() },
          ]}
          onClose={() => setManageOpen(false)}
        />
      )}
      {sheetEl()}
      {rowMenuEl()}
      {pickerEl()}
      {fitEl()}
      {doorPickEl()}
      {switcherEl}
      {receiptEl}
    </>
  );
}

// The archived list is not draggable and does not switch on tap: archive is a
// quiet shelf, not a second active list (§3.11's own framing).
//
// GYM-F-26 (2026-09-05): it announced itself as a button and then did nothing
// on activate, because long-press was the only way in and useLongPress has no
// key path. The row is no longer a button it cannot honour; the trailing pill
// is the door, and it works by tap, by key and to a screen reader.
function ProgramRowStatic({ program, onMenu }: { program: Program; onMenu: () => void }) {
  const hold = useLongPress({ onLongPress: onMenu });
  return (
    // The row opens the same menu its trailing button does (Dave 2026-09-15:
    // "I want all rows clickable").
    <div className="row" {...hold} {...rowDoor(onMenu)}>
      <div className="row-grow"><div className="conn-name truncate">{program.data.name}</div></div>
      <RowMenuButton onMenu={onMenu} what={program.data.name} />
    </div>
  );
}
