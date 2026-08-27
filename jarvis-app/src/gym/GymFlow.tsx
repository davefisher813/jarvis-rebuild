import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useGym, useOptionalSchedule, useOptionalCategories } from "../data/NotesProvider";
import { todayISO } from "../tasks/grouping";
import { monthDay } from "../money/bills";
import type { Exercise, Program, ProgramDay, ProgramWeek, Workout, SetEntry, WorkoutExercise } from "./types";
import { targetLine } from "./measures";
import { receiptFor, type Receipt } from "./prs";
import { readLive, writeLive, clearLive, logSet, setLoggedSets, skipExercise, swapExercise, addExerciseMidSession, sessionExercisesSameAsLastTime, queueFinished, flushPending, hasWork, type LiveSession } from "./liveSession";
import { bumpStrip, newSetId } from "./strip";
import { buildLibrary } from "./library";
import { pairLabels, pairExercises, unpairExercise } from "./pairs";
import {
  nextCopyName, duplicateExercise, duplicateDay, duplicateProgramData,
  moveExerciseToDay, copyExerciseToDays, extractDay, appendDayToWeek,
} from "./edit";
import ExerciseSheet from "./ExerciseSheet";
import SessionScreen from "./SessionScreen";
import ReceiptSheet from "./ReceiptSheet";
import UploadFlow from "./UploadFlow";
import HistoryScreen from "./HistoryScreen";
import ActionSheet, { PickSheet, type SheetAction, type PickItem } from "./ActionSheet";
import SetStrip from "./SetStrip";
import ReorderList from "../shared/ReorderList";
import { usePushDepth } from "../shared/pushNav";
import { useLongPress } from "../shared/useLongPress";
import { showToast } from "../shared/toast";
import { useAI } from "../ai/useAI";
import { capAfterNumber } from "../shared/casing";
import { BarbellGlyph } from "../shared/glyphs";
import Stepper from "../shared/Stepper";

const CHEV = (
  <div className="chev" />
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const DUMBBELL = (
  <BarbellGlyph />
);

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

function readActiveProgramId(): string | null {
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
            <input className="input" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
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
          <button className="btn btn-primary btn-block" disabled={busy}
            onClick={() => { if (v.trim()) { setBusy(true); onSave(v.trim()); } }}>{busy ? "Saving..." : "Save"}</button>
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
            <div className="input-label">Add To Every Weight</div>
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
          <button className="btn btn-primary btn-block" onClick={() => onSave({ w, r }, backOff)}>Duplicate & Bump</button>
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
          <button className="btn btn-primary btn-block" onClick={() => onStart(date || todayISO())}>Start Logging</button>
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
function DayRow({ day, onOpen, onMenu }: { day: ProgramDay; onOpen: () => void; onMenu: () => void }) {
  const hold = useLongPress({ onLongPress: onMenu });
  return (
    <div className="row-grow" role="button" tabIndex={0} onClick={onOpen} {...hold}>
      <div className="row-grow">
        <div className="conn-name truncate">{day.name}</div>
        <div className="eyebrow">{day.exercises.length} {day.exercises.length === 1 ? "exercise" : "exercises"}</div>
      </div>
      {CHEV}
    </div>
  );
}

function ExerciseRow({ exercise, pairLabel, onOpen, onMenu }: { exercise: Exercise; pairLabel?: string; onOpen: () => void; onMenu: () => void }) {
  const hold = useLongPress({ onLongPress: onMenu });
  return (
    <div className="row-grow" role="button" tabIndex={0} onClick={onOpen} {...hold}>
      <div className="row-grow">
        <div className="conn-name truncate">{pairLabel ? `${pairLabel} · ` : ""}{exercise.name}</div>
        <div className="eyebrow">{targetLine(exercise)}</div>
      </div>
      {CHEV}
    </div>
  );
}

function ProgramRow({ program, active, onSwitch, onMenu }: { program: Program; active: boolean; onSwitch: () => void; onMenu: () => void }) {
  const hold = useLongPress({ onLongPress: onMenu });
  return (
    <div className="row-grow" role="button" tabIndex={0} onClick={onSwitch} {...hold}>
      <div className="row-grow">
        <div className="conn-name truncate">{program.data.name}</div>
        <div className="eyebrow">{active ? "Active" : program.data.archived ? "Archived" : ""}</div>
      </div>
      {active && <span className="pill pill-good">Active</span>}
    </div>
  );
}

type Sheet =
  | { kind: "closed" }
  | { kind: "program"; programId?: string }
  | { kind: "week"; weekId?: string }
  | { kind: "day"; weekId: string; dayId?: string }
  | { kind: "exercise"; weekId: string; dayId: string; exId?: string }
  | { kind: "bump"; weekId: string };

type RowMenu =
  | { kind: "day"; weekId: string; day: ProgramDay }
  | { kind: "exercise"; weekId: string; dayId: string; exercise: Exercise }
  | { kind: "program"; program: Program };

type Picker =
  | { kind: "moveExerciseToDay"; weekId: string; dayId: string; exId: string }
  | { kind: "copyExerciseToDays"; weekId: string; dayId: string; exId: string }
  | { kind: "pairWith"; weekId: string; dayId: string; exId: string }
  | { kind: "moveDayProgram"; weekId: string; day: ProgramDay }
  | { kind: "moveDayWeek"; targetProgramId: string; day: ProgramDay };

// The gym track: programs in the user's own words, weeks as the time axis,
// the set strip as the same object in the plan and in the live session, the
// in-gym loop, live PRs, and an honest receipt.
export default function GymFlow({ onBack }: { onBack: () => void }) {
  const svc = useGym();
  const ai = useAI();
  const schedule = useOptionalSchedule();
  const categoriesSvc = useOptionalCategories();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [allPrograms, setAllPrograms] = useState<Program[]>([]); // active + archived
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [activeProgramId, setActiveProgramId] = useState<string | null>(() => readActiveProgramId());
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);
  const [openDayId, setOpenDayId] = useState<string | null>(null);
  // Seed from storage (2026-08-09): an in-progress session used to be
  // invisible until startDay silently overwrote it. Same-day sessions resume
  // right where they were; an older one with real work is SAVED as a partial
  // workout on mount (a logged set is never lost), and an empty one clears.
  // LOG IT LATER (catalog §3.8): a backdated session is not "stale" just
  // because its date is not today, so it is kept on the same terms.
  const [live, setLive] = useState<LiveSession | null>(() => {
    const s = readLive();
    return s && (s.date === todayISO() || s.backdated) ? s : null;
  });
  const [receipt, setReceipt] = useState<{ receipt: Receipt; dayName: string } | null>(null);
  const [viewWorkout, setViewWorkout] = useState<Workout | null>(null);
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutExercise[] | null>(null);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [backdateDay, setBackdateDay] = useState<ProgramDay | null>(null);
  const [nextGame, setNextGame] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
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
  const library = useMemo(() => buildLibrary(allPrograms, workouts), [allPrograms, workouts]);

  const reload = useCallback(async () => {
    // Anything logged offline lands as soon as a write succeeds.
    await flushPending((w) => svc.saveWorkout(w));
    const [all, ws] = await Promise.all([svc.listPrograms(true), svc.listWorkouts()]);
    setAllPrograms(all);
    setPrograms(all.filter((p) => !p.data.archived));
    setWorkouts(ws);
    setLive(readLive());
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);

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
      let found: string | null = null;
      for (let i = 0; i <= 7; i++) {
        const d = new Date(today + "T00:00:00");
        d.setDate(d.getDate() + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        if (items.some((e) => e.data.category === catId && occursOn(e.data, iso))) { found = iso; break; }
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
      if (!cancelled) setCategories(list.map((c) => ({ id: c.id, name: c.data.name })));
    })();
    return () => { cancelled = true; };
  }, [categoriesSvc]);

  usePushDepth(
    live
      ? (openDayId ? (multiWeek ? 3 : 2) : 1)
      : openDayId
        ? (multiWeek ? 2 : 1)
        : (multiWeek && openWeekId) || historyOpen || uploadOpen
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
  const saveUploaded = async (p: { name: string; weeks: Program["data"]["weeks"] }) => {
    setUploadOpen(false);
    if (program) {
      // Merge into the active program: uploaded weeks append after existing ones.
      await svc.updateProgram(program.id, { name: p.name, weeks: [...program.data.weeks, ...p.weeks] });
    } else {
      await svc.createProgram({ name: p.name, weeks: p.weeks });
    }
    await reload();
    showToast({ message: "Program saved · Check days once" });
  };

  const saveWeeks = async (nextWeeks: ProgramWeek[]) => {
    if (!program) return;
    await svc.updateProgram(program.id, { weeks: nextWeeks });
    await reload();
  };
  const saveDays = async (weekId: string, days: ProgramDay[]) => {
    if (!program) return;
    await saveWeeks(program.data.weeks.map((w) => (w.id === weekId ? { ...w, days } : w)));
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
    await saveDays(weekId, duplicateDay(week, dayId).days);
    showToast({ message: "Day duplicated" });
  };
  const duplicateExerciseAction = async (weekId: string, dayId: string, exId: string) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    const day = week?.days.find((d) => d.id === dayId);
    if (!week || !day) return;
    await saveDays(weekId, week.days.map((d) => (d.id === dayId ? duplicateExercise(day, exId) : d)));
    showToast({ message: "Exercise duplicated" });
  };
  const moveExerciseAction = async (fromDayId: string, exId: string, toDayId: string) => {
    if (!program) return;
    await saveWeeks(moveExerciseToDay(program.data.weeks, fromDayId, exId, toDayId));
    showToast({ message: "Exercise moved" });
  };
  const copyExerciseAction = async (fromDayId: string, exId: string, toDayIds: string[]) => {
    if (!program) return;
    await saveWeeks(copyExerciseToDays(program.data.weeks, fromDayId, exId, toDayIds));
    showToast({ message: `Copied to ${toDayIds.length} ${toDayIds.length === 1 ? "day" : "days"}` });
  };
  const pairAction = async (weekId: string, dayId: string, aId: string, bId: string) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    const day = week?.days.find((d) => d.id === dayId);
    if (!week || !day) return;
    await saveDays(weekId, week.days.map((d) => (d.id === dayId ? { ...d, exercises: pairExercises(day.exercises, aId, bId) } : d)));
    showToast({ message: "Paired" });
  };
  const unpairAction = async (weekId: string, dayId: string, exId: string) => {
    const week = program?.data.weeks.find((w) => w.id === weekId);
    const day = week?.days.find((d) => d.id === dayId);
    if (!week || !day) return;
    await saveDays(weekId, week.days.map((d) => (d.id === dayId ? { ...d, exercises: unpairExercise(day.exercises, exId) } : d)));
  };
  const moveDayToProgramAction = async (sourceWeekId: string, day: ProgramDay, targetProgramId: string, targetWeekId: string) => {
    if (!program) return;
    const { weeks: sourceLeft } = extractDay(program.data.weeks, day.id);
    await svc.updateProgram(program.id, { weeks: sourceLeft });
    const target = programs.find((p) => p.id === targetProgramId);
    if (target) {
      await svc.updateProgram(target.id, { weeks: appendDayToWeek(target.data.weeks, targetWeekId, day, true) });
    }
    if (openDayId === day.id) setOpenDayId(null);
    await reload();
    showToast({ message: `Moved to ${target?.data.name ?? "another program"}` });
  };
  const duplicateProgramAction = async (p: Program) => {
    await svc.createProgram(duplicateProgramData(p.data));
    await reload();
    showToast({ message: "Program duplicated" });
  };
  const archiveProgramAction = async (p: Program, archived: boolean) => {
    await svc.updateProgram(p.id, { archived });
    if (archived && activeProgramId === p.id) {
      const next = programs.find((x) => x.id !== p.id);
      if (next) switchProgram(next.id);
    }
    await reload();
    showToast({ message: archived ? "Program archived" : "Program restored" });
  };

  // ---- in-gym ----
  // Recover a stale session left from another day (2026-08-09): real work
  // gets saved as the partial workout it was; an empty shell just clears.
  // Without this, the next startDay would have silently destroyed it.
  // A BACKDATED session (catalog §3.8) is not stale just because its date is
  // not today, so it is left alone here.
  useEffect(() => {
    const s = readLive();
    if (!s || s.date === todayISO() || s.backdated) return;
    clearLive();
    if (hasWork(s.exercises)) {
      queueFinished({ programId: s.programId, dayId: s.dayId, dayName: s.dayName, date: s.date, startedAt: s.startedAt, endedAt: s.startedAt, exercises: s.exercises });
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

  const startDay = (day: ProgramDay, opts: { date?: string; sameAsLastTime?: boolean } = {}) => {
    if (!program) return;
    // Never overwrite logged work (2026-08-09): if a session with real sets
    // is already going -- today's or a still-open backdated one -- starting a
    // day RESUMES it instead of destroying it.
    const existing = readLive();
    if (existing && hasWork(existing.exercises)) {
      setLive(existing);
      showToast({ message: "Resumed your open workout" });
      return;
    }
    const date = opts.date ?? todayISO();
    const backdated = date !== todayISO();
    const last = opts.sameAsLastTime ? lastWorkoutForDay(day.id) : null;
    const exercises = last
      ? sessionExercisesSameAsLastTime(day, last.data)
      : day.exercises.map((e) => ({ exerciseId: e.id, name: e.name, kind: e.kind, unit: e.unit, timeUnit: e.timeUnit, exerciseKey: e.exerciseKey, sets: [] }));
    const s: LiveSession = {
      programId: program.id, dayId: day.id, dayName: day.name, date,
      startedAt: Date.now(), idx: 0, exercises,
      ...(backdated ? { backdated: true } : {}),
      ...(opts.sameAsLastTime ? { sameAsLastTime: true } : {}),
    };
    writeLive(s);
    setLive(s);
    if (opts.sameAsLastTime && !last) showToast({ message: "No prior session for this day yet · Starting fresh" });
  };
  const update = (next: LiveSession) => { writeLive(next); setLive(next); };

  const finish = async () => {
    if (!live) return;
    const endedAt = Date.now();
    const r = receiptFor(live.exercises, workouts, live.startedAt, endedAt);
    const data = {
      programId: live.programId, dayId: live.dayId, dayName: live.dayName, date: live.date,
      startedAt: live.startedAt, endedAt, exercises: live.exercises,
      ...(live.backdated ? { backdated: true } : {}),
    };
    clearLive();
    setLive(null);
    // Land on the day list, not back on the exercise: the day detail is a
    // dead end after a session, while the program page shows what just
    // happened and what is next.
    setOpenDayId(null);
    if (hasWork(live.exercises)) {
      // Queue first, then try: a failed write must never lose the session.
      queueFinished(data);
      await flushPending((w) => svc.saveWorkout(w));
      setReceipt({ receipt: r, dayName: live.dayName });
    } else {
      showToast({ message: "Nothing logged · Nothing saved" });
    }
    await reload();
  };

  if (uploadOpen) {
    return <UploadFlow ai={ai} onSave={(p) => void saveUploaded(p)} onCancel={() => setUploadOpen(false)} />;
  }
  if (historyOpen) {
    return <HistoryScreen workouts={workouts} onBack={() => setHistoryOpen(false)} />;
  }
  if (viewWorkout && workoutDraft) {
    const w = viewWorkout;
    const mins = Math.max(1, Math.round((w.data.endedAt - w.data.startedAt) / 60000));
    const dirty = JSON.stringify(workoutDraft) !== JSON.stringify(w.data.exercises);
    const closeWorkout = () => { setViewWorkout(null); setWorkoutDraft(null); };
    return (
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={closeWorkout}></button>
          <div className="nav-title">{w.data.dayName}</div>
          <span className="nav-action"></span>
        </div>
        <div className="grp"><div className="eyebrow">{monthDay(w.data.date)} · {mins} min{w.data.backdated ? " · Logged Later" : ""}</div></div>
        {/* EDIT A FINISHED WORKOUT (catalog §3.7): tap any set to edit or
            delete it, add one you forgot, all through the same set strip
            that planned and logged it. PRs and the receipt are both derived
            from the workout list at render time, so saving here recomputes
            every number downstream for free. */}
        {w.data.exercises.map((e, ei) => (
          <div key={e.exerciseId + ei}>
            <div className="sec-head"><div className="sec-left"><div className="sec-title">{e.name}</div></div></div>
            <div className="pad-x">
              <SetStrip
                kind={e.kind}
                unit={e.unit}
                timeUnit={e.timeUnit}
                entries={workoutDraft[ei]?.sets ?? []}
                onChange={(sets) => setWorkoutDraft((d) => d && d.map((x, i) => (i === ei ? { ...x, sets } : x)))}
                moveTracking
              />
            </div>
          </div>
        ))}
        <div className="pad-x sheet-actions">
          {dirty && (
            <button className="btn btn-primary btn-block" onClick={async () => {
              await svc.updateWorkout(w.id, { exercises: workoutDraft });
              await reload();
              showToast({ message: "Workout updated" });
              closeWorkout();
            }}>Save Changes</button>
          )}
          {/* Delete with Undo (2026-08-09): PRs and history derive from the
              workout list, so removing a mislogged session heals every number
              downstream. Same toast contract as every delete in the app. */}
          <button className="btn btn-danger btn-block" onClick={async () => {
            const gone = { ...w.data };
            await svc.removeWorkout(w.id);
            closeWorkout();
            await reload();
            showToast({
              message: "Workout deleted",
              actionLabel: "Undo",
              onAction: async () => { await svc.saveWorkout(gone); await reload(); },
            });
          }}>Delete Workout</button>
        </div>
        <div className="screen-foot" />
      </div>
    );
  }
  if (live) {
    const day = program ? findDay(program.data.weeks, live.dayId) : undefined;
    const liveEx = live.exercises[live.idx];
    const planned = day?.exercises[live.idx];
    // SWAP / ADD MID-SESSION / SAME AS LAST TIME (catalog §3.9, §3.10,
    // §3.13): a `custom` entry carries its own identity and plan rather than
    // reading the program day's own exercise at this index.
    const exercise: Exercise | undefined = liveEx?.custom
      ? { id: liveEx.exerciseId, name: liveEx.name, kind: liveEx.kind, unit: liveEx.unit, timeUnit: liveEx.timeUnit, exerciseKey: liveEx.exerciseKey, sets: liveEx.plan ?? [] }
      : planned ?? (liveEx ? { id: liveEx.exerciseId, name: liveEx.name, kind: liveEx.kind, unit: liveEx.unit, timeUnit: liveEx.timeUnit, sets: [] } : undefined);
    if (!exercise) return <div className="screen" />;
    return (
      <SessionScreen
        live={live}
        exercise={exercise}
        dayExercises={liveEx?.custom ? [] : (day?.exercises ?? [])}
        history={workouts}
        library={library}
        onLog={(s: SetEntry) => update(logSet(live, live.idx, s))}
        onSetLogged={(sets: SetEntry[]) => update(setLoggedSets(live, live.idx, sets))}
        onSkip={() => update({ ...skipExercise(live, live.idx), idx: Math.min(live.idx + 1, live.exercises.length - 1) })}
        onMove={(i) => update({ ...live, idx: i })}
        onSwap={(sub) => { update(swapExercise(live, live.idx, sub)); showToast({ message: `Swapped in ${sub.name}` }); }}
        onAddMidSession={(draft) => { update(addExerciseMidSession(live, { exerciseKey: draft.exerciseKey, name: draft.name, kind: draft.kind, unit: draft.unit, timeUnit: draft.timeUnit, plan: draft.sets })); showToast({ message: `Added ${draft.name}` }); }}
        onFinish={() => void finish()}
        onBack={() => setLive(null)}
      />
    );
  }

  const recent = [...workouts].reverse().slice(0, 5);

  // "Next: X" only when there is one week (the common, migrated case): which
  // day comes next across a multi-week block is a real product decision the
  // catalog itself leaves open (PART 8, Q3), so it is not guessed at here.
  const singleWeek = !multiWeek ? weeks[0] ?? null : null;
  const nextDay = (() => {
    if (!singleWeek || singleWeek.days.length === 0) return null;
    const last = recent[0];
    if (!last) return singleWeek.days[0]!;
    const i = singleWeek.days.findIndex((d) => d.id === last.data.dayId);
    return singleWeek.days[(i + 1) % singleWeek.days.length] ?? singleWeek.days[0]!;
  })();

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
            if (target) await svc.updateProgram(target.id, { name, inSeason: programSeasonDraft, gameCategoryId: programSeasonDraft ? programGameCategoryDraft : undefined });
            else await svc.createProgram({ name, weeks: [{ id: nid("w"), label: "Week 1", days: [] }] });
            await reload();
          }}
          onDelete={target ? async () => {
            setSheet({ kind: "closed" });
            await svc.removeProgram(target.id);
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
            const days: ProgramDay[] = src.days.map((d) => ({
              id: nid("d"),
              name: d.name,
              exercises: d.exercises.map((e): Exercise => ({
                ...e,
                id: nid("e"),
                sets: bumpStrip(e.kind, e.sets.map((s): SetEntry => ({ ...s, id: newSetId() })), bump),
              })),
            }));
            const week: ProgramWeek = {
              id: nid("w"), label: `Week ${program.data.weeks.length + 1}`, days,
              ...(backOff ? { backOff: true } : {}),
            };
            setSheet({ kind: "closed" });
            await saveWeeks([...program.data.weeks, week]);
            showToast({ message: `${week.label} added · Duplicated from ${src.label}` });
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
    if (sheet.kind === "exercise") {
      const week = program.data.weeks.find((w) => w.id === sheet.weekId);
      const day = week?.days.find((d) => d.id === sheet.dayId);
      const existing = sheet.exId ? day?.exercises.find((e) => e.id === sheet.exId) : undefined;
      return (
        <ExerciseSheet
          mode={existing ? "edit" : "new"}
          initial={existing}
          library={library}
          onSave={async (draft) => {
            if (!week || !day) return;
            const days = week.days.map((d) => {
              if (d.id !== day.id) return d;
              const exercises = existing
                ? d.exercises.map((e) => (e.id === existing.id ? { ...draft, id: existing.id } : e))
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
        if (exercise.pairWith) {
          actions.push({ label: "Unpair", onClick: () => void unpairAction(weekId, dayId, exercise.id) });
        } else {
          actions.push({ label: "Pair With...", onClick: () => setPicker({ kind: "pairWith", weekId, dayId, exId: exercise.id }) });
        }
      }
      actions.push({ label: "Delete...", onClick: () => setSheet({ kind: "exercise", weekId, dayId, exId: exercise.id }) });
      return <ActionSheet title={exercise.name} actions={actions} onClose={() => setRowMenu(null)} />;
    }
    if (rowMenu.kind === "program") {
      const p = rowMenu.program;
      const actions: SheetAction[] = [
        { label: "Duplicate", onClick: () => void duplicateProgramAction(p) },
        p.data.archived
          ? { label: "Restore From Archive", onClick: () => void archiveProgramAction(p, false) }
          : { label: "Archive", onClick: () => void archiveProgramAction(p, true) },
      ];
      return <ActionSheet title={p.data.name} actions={actions} onClose={() => setRowMenu(null)} />;
    }
    return null;
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
    if (picker.kind === "pairWith") {
      const week = program?.data.weeks.find((w) => w.id === picker.weekId);
      const day = week?.days.find((d) => d.id === picker.dayId);
      const items: PickItem[] = (day?.exercises ?? []).filter((e) => e.id !== picker.exId).map((e) => ({ id: e.id, label: e.name }));
      return (
        <PickSheet
          title="Pair With"
          items={items}
          onPick={(ids) => { setPicker(null); void pairAction(picker.weekId, picker.dayId, picker.exId, ids[0]!); }}
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

  const receiptEl = receipt
    ? <ReceiptSheet dayName={receipt.dayName} receipt={receipt.receipt} workouts={workouts} onDone={() => setReceipt(null)} />
    : null;

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
                void Promise.all(programs.map((p) => svc.updateProgram(p.id, { order: order.get(p.id) ?? 0 }))).then(reload);
              }}
              renderRow={(id) => {
                const p = programs.find((x) => x.id === id);
                if (!p) return null;
                return <ProgramRow program={p} active={p.id === program?.id} onSwitch={() => switchProgram(p.id)} onMenu={() => setRowMenu({ kind: "program", program: p })} />;
              }}
            />
            <button className="row row-act" onClick={() => { setSwitcherOpen(false); openProgramSheet(); }}>Add Program</button>
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
      const labels = pairLabels(openDay.exercises);
      const lastForDay = lastWorkoutForDay(openDay.id);
      return (
        <>
          <div className="screen">
            <div className="nav-bar">
              <button className="nav-back" aria-label="Back" onClick={() => setOpenDayId(null)}></button>
              <div className="nav-title truncate">{openDay.name}</div>
              <button className="nav-action-text" onClick={() => setSheet({ kind: "day", weekId: activeWeek.id, dayId: openDay.id })}>Edit</button>
            </div>
            <div className="sh2"><span className="t">Exercises</span></div>
            <div><div className="list-flat">
              <ReorderList
                ids={openDay.exercises.map((e) => e.id)}
                onReorder={(ids) => void reorderExercises(activeWeek.id, openDay.id, ids)}
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
              <button className="row row-act" onClick={() => setSheet({ kind: "exercise", weekId: activeWeek.id, dayId: openDay.id })}>Add Exercise</button>
            </div></div>
            {openDay.exercises.length > 0 && (
              <div className="pad-x gym-log">
                <button className="btn btn-primary btn-block btn-lg" onClick={() => startDay(openDay)}>Start {openDay.name}</button>
                {lastForDay && (
                  // SAME AS LAST TIME (catalog §3.13): the fastest possible
                  // entry, pre-filled with what actually happened last time.
                  <button className="row row-act" onClick={() => startDay(openDay, { sameAsLastTime: true })}>Same As Last Time</button>
                )}
                {/* LOG IT LATER (catalog §3.8): the phone was in a locker. */}
                <button className="row row-act" onClick={() => setBackdateDay(openDay)}>Log a Past Workout</button>
              </div>
            )}
            <div className="screen-foot" />
          </div>
          {sheetEl()}
          {rowMenuEl()}
          {pickerEl()}
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
        <div className="screen">
          <div className="nav-bar">
            <button className="nav-back" aria-label="Back" onClick={() => setOpenWeekId(null)}></button>
            <div className="nav-title truncate">{activeWeek.label}</div>
            <button className="nav-action-text" onClick={() => openWeekSheet(activeWeek.id)}>Edit</button>
          </div>
          {activeWeek.backOff && (
            <div className="pad-x"><span className="pill pill-subdued">Back-Off Week</span></div>
          )}
          <div className="sh2"><span className="t">Days</span></div>
          <div><div className="list-flat">
            <ReorderList
              ids={activeWeek.days.map((d) => d.id)}
              onReorder={(ids) => void reorderDays(activeWeek.id, ids)}
              renderRow={(id) => {
                const d = activeWeek.days.find((x) => x.id === id);
                if (!d) return null;
                return (
                  <DayRow
                    day={d}
                    onOpen={() => setOpenDayId(d.id)}
                    onMenu={() => setRowMenu({ kind: "day", weekId: activeWeek.id, day: d })}
                  />
                );
              }}
            />
            <button className="row row-act" onClick={() => setSheet({ kind: "day", weekId: activeWeek.id })}>Add Day</button>
          </div></div>
          <div className="pad-x">
            <button className="btn btn-secondary btn-block" onClick={() => setSheet({ kind: "bump", weekId: activeWeek.id })}>Duplicate {activeWeek.label} & Bump</button>
          </div>
          <div className="screen-foot" />
        </div>
        {sheetEl()}
        {rowMenuEl()}
        {pickerEl()}
        {receiptEl}
      </>
    );
  }

  return (
    <>
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={onBack}></button>
          <div className="nav-title truncate">{program ? program.data.name : "Training"}</div>
          {program && <button className="nav-action-text" onClick={() => openProgramSheet(program)}>Edit</button>}
        </div>

        {!program ? (
          <div className="empty-state">
            <div className="empty-icon">{DUMBBELL}</div>
            <div className="empty-title">No Program Yet</div>
            <button className="btn btn-primary" onClick={() => openProgramSheet()}>Create a Program</button>
            {ai.available && <button className="btn btn-secondary" onClick={() => setUploadOpen(true)}>Upload One Instead</button>}
          </div>
        ) : (
          <>
            {/* MULTIPLE PROGRAMS & ARCHIVE (catalog §3.11): always reachable,
                even with just one program today, so creating a second one
                and archiving a retired block are never a hunt. */}
            <div className="pad-x">
              <div className="row" role="button" tabIndex={0} onClick={() => setSwitcherOpen(true)}>
                <div className="row-grow">
                  <div className="eyebrow">Program</div>
                  <div className="conn-name">{program.data.name}{programs.length > 1 ? ` · ${programs.length} Active` : ""}</div>
                </div>
                {CHEV}
              </div>
            </div>

            {program.data.inSeason && (
              // THE SEASON LINK (catalog §4.7): strictly a fact, never a
              // prescription -- the calendar day a game lands on, nothing
              // about what to do with the lift.
              <div className="pad-x"><div className="bp-sub">
                {nextGame ? `Next Game: ${monthDay(nextGame)}` : "In-Season"}
              </div></div>
            )}

            {nextDay && nextDay.exercises.length > 0 && (
              <div className="pad-x"><div className="card pad">
                <div className="conn-name">Next: {nextDay.name}</div>
                <div className="bp-sub">{nextDay.exercises.length} {nextDay.exercises.length === 1 ? "exercise" : "exercises"}{recent[0] ? ` · Last trained ${monthDay(recent[0].data.date)}` : ""}</div>
                <div className="offer-row">
                  <button className="btn btn-primary" onClick={() => startDay(nextDay)}>Start {nextDay.name}</button>
                </div>
              </div></div>
            )}

            {multiWeek ? (
              <>
                <div className="sh2"><span className="t">Weeks</span></div>
                <div><div className="list-flat">
                  {weeks.map((w) => (
                    <div className="row" role="button" tabIndex={0} key={w.id} onClick={() => setOpenWeekId(w.id)}>
                      <div className="row-grow">
                        <div className="conn-name truncate">
                          {w.label}
                          {w.backOff && <span className="pill pill-subdued week-back-off">Back-Off</span>}
                        </div>
                        <div className="eyebrow">{w.days.length} {w.days.length === 1 ? "day" : "days"}</div>
                      </div>
                      {CHEV}
                    </div>
                  ))}
                  <button className="row row-act" onClick={() => openWeekSheet()}>Add Week</button>
                </div></div>
              </>
            ) : (
              <>
                <div className="sh2"><span className="t">Days</span></div>
                <div><div className="list-flat">
                  {singleWeek && (
                    <ReorderList
                      ids={singleWeek.days.map((d) => d.id)}
                      onReorder={(ids) => void reorderDays(singleWeek.id, ids)}
                      renderRow={(id) => {
                        const d = singleWeek.days.find((x) => x.id === id);
                        if (!d) return null;
                        return (
                          <DayRow
                            day={d}
                            onOpen={() => setOpenDayId(d.id)}
                            onMenu={() => setRowMenu({ kind: "day", weekId: singleWeek.id, day: d })}
                          />
                        );
                      }}
                    />
                  )}
                  {singleWeek && <button className="row row-act" onClick={() => setSheet({ kind: "day", weekId: singleWeek.id })}>Add Day</button>}
                  {ai.available && (
                    <div className="row" role="button" tabIndex={0} onClick={() => setUploadOpen(true)}>
                      <div className="row-grow"><div className="conn-name">Upload a Program</div></div>
                      {CHEV}
                    </div>
                  )}
                  {singleWeek && (
                    <div className="row" role="button" tabIndex={0} onClick={() => openWeekSheet()}>
                      <div className="row-grow"><div className="conn-name">Add a Week</div></div>
                      {CHEV}
                    </div>
                  )}
                </div></div>
              </>
            )}

            {recent.length > 0 && (
              <>
                <div className="sh2"><span className="t">Recent</span><button className="see-all" onClick={() => setHistoryOpen(true)}>History</button></div>
                <div><div className="list-flat">
                  {recent.map((w) => {
                    const logged = w.data.exercises.filter((e) => e.sets.some((s) => !s.skipped)).length;
                    const total = w.data.exercises.length;
                    const mins = Math.max(1, Math.round((w.data.endedAt - w.data.startedAt) / 60000));
                    return (
                      // Tappable since 2026-08-09: these rows were inert, which
                      // made a mislogged workout permanent. The detail sheet
                      // carries the delete.
                      <div className="row" role="button" tabIndex={0} key={w.id} onClick={() => { setViewWorkout(w); setWorkoutDraft(w.data.exercises); }}>
                        <div className="row-grow">
                          <div className="conn-name truncate">{w.data.dayName}</div>
                          {/* Partial work is stated as the fact it is: never a
                              percentage, never a shortfall. */}
                          <div className="eyebrow">{monthDay(w.data.date)} · {mins} min · {logged === total ? capAfterNumber(`${total} ${total === 1 ? "exercise" : "exercises"}`) : capAfterNumber(`${logged} of ${total} exercises`)}</div>
                        </div>
                        {CHEV}
                      </div>
                    );
                  })}
                </div></div>
              </>
            )}
            <div className="screen-foot" />
          </>
        )}
      </div>

      {sheetEl()}
      {rowMenuEl()}
      {pickerEl()}
      {switcherEl}
      {receiptEl}
    </>
  );
}

// The archived list is not draggable and never opens by tap -- long-press
// (Unarchive / Duplicate) is the only way in, matching §3.11's own framing
// of archive as a quiet shelf, not a second active list.
function ProgramRowStatic({ program, onMenu }: { program: Program; onMenu: () => void }) {
  const hold = useLongPress({ onLongPress: onMenu });
  return (
    <div className="row" role="button" tabIndex={0} {...hold}>
      <div className="row-grow"><div className="conn-name truncate">{program.data.name}</div></div>
    </div>
  );
}
