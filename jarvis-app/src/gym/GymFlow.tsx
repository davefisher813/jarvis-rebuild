import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useGym } from "../data/NotesProvider";
import { todayISO } from "../tasks/grouping";
import { monthDay } from "../money/bills";
import type { Exercise, Program, ProgramDay, ProgramWeek, Workout, SetEntry } from "./types";
import { targetLine } from "./measures";
import { receiptFor, type Receipt } from "./prs";
import { readLive, writeLive, clearLive, logSet, setLoggedSets, skipExercise, queueFinished, flushPending, hasWork, type LiveSession } from "./liveSession";
import { bumpStrip, newSetId } from "./strip";
import ExerciseSheet from "./ExerciseSheet";
import SessionScreen from "./SessionScreen";
import ReceiptSheet from "./ReceiptSheet";
import UploadFlow from "./UploadFlow";
import HistoryScreen from "./HistoryScreen";
import { usePushDepth } from "../shared/pushNav";
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

let seq = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

function findDay(weeks: ProgramWeek[], dayId: string): ProgramDay | undefined {
  for (const w of weeks) {
    const d = w.days.find((x) => x.id === dayId);
    if (d) return d;
  }
  return undefined;
}

function NameSheet({ title, initial, placeholder, backOff, onSave, onDelete, onCancel }: {
  title: string; initial?: string; placeholder: string;
  backOff?: { value: boolean; onChange: (v: boolean) => void };
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

type Sheet =
  | { kind: "closed" }
  | { kind: "program" }
  | { kind: "week"; weekId?: string }
  | { kind: "day"; weekId: string; dayId?: string }
  | { kind: "exercise"; weekId: string; dayId: string; exId?: string }
  | { kind: "bump"; weekId: string };

// The gym track: programs in the user's own words, weeks as the time axis,
// the set strip as the same object in the plan and in the live session, the
// in-gym loop, live PRs, and an honest receipt.
export default function GymFlow({ onBack }: { onBack: () => void }) {
  const svc = useGym();
  const ai = useAI();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [openWeekId, setOpenWeekId] = useState<string | null>(null);
  const [openDayId, setOpenDayId] = useState<string | null>(null);
  // Seed from storage (2026-08-09): an in-progress session used to be
  // invisible until startDay silently overwrote it. Same-day sessions resume
  // right where they were; an older one with real work is SAVED as a partial
  // workout on mount (a logged set is never lost), and an empty one clears.
  const [live, setLive] = useState<LiveSession | null>(() => {
    const s = readLive();
    return s && s.date === todayISO() ? s : null;
  });
  const [receipt, setReceipt] = useState<{ receipt: Receipt; dayName: string } | null>(null);
  const [viewWorkout, setViewWorkout] = useState<Workout | null>(null);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The week sheet's "Normal / Back-Off" choice, held at the top level so it
  // is one plain useState called unconditionally on every render -- NOT
  // inside sheetEl(), which is called from different branches depending on
  // what is open and would otherwise call a hook a different number of times
  // between renders (react-hooks/rules-of-hooks is a build gate here).
  const [weekBackOffDraft, setWeekBackOffDraft] = useState(false);

  const program = programs[0] ?? null; // v1: one program at a time
  const weeks = program?.data.weeks ?? [];
  const multiWeek = weeks.length > 1;
  const activeWeek = multiWeek ? (weeks.find((w) => w.id === openWeekId) ?? null) : (weeks[0] ?? null);
  const openWeekSheet = (weekId?: string) => {
    const w = weekId ? weeks.find((x) => x.id === weekId) : undefined;
    setWeekBackOffDraft(w?.backOff ?? false);
    setSheet({ kind: "week", weekId });
  };

  const reload = useCallback(async () => {
    // Anything logged offline lands as soon as a write succeeds.
    await flushPending((w) => svc.saveWorkout(w));
    const [ps, ws] = await Promise.all([svc.listPrograms(), svc.listWorkouts()]);
    setPrograms(ps);
    setWorkouts(ws);
    setLive(readLive());
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);

  usePushDepth(
    live
      ? (openDayId ? (multiWeek ? 3 : 2) : 1)
      : openDayId
        ? (multiWeek ? 2 : 1)
        : (multiWeek && openWeekId) || historyOpen || uploadOpen
          ? 1
          : 0,
  );

  // Upload (gym session 2): photo/screenshot or pasted text -> review -> save.
  // Gated on AI availability like every AI-dependent offer.
  const saveUploaded = async (p: { name: string; weeks: Program["data"]["weeks"] }) => {
    setUploadOpen(false);
    if (program) {
      // Merge into the one program: uploaded weeks append after existing ones.
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

  // ---- in-gym ----
  // Recover a stale session left from another day (2026-08-09): real work
  // gets saved as the partial workout it was; an empty shell just clears.
  // Without this, the next startDay would have silently destroyed it.
  useEffect(() => {
    const s = readLive();
    if (!s || s.date === todayISO()) return;
    clearLive();
    if (hasWork(s.exercises)) {
      queueFinished({ programId: s.programId, dayId: s.dayId, dayName: s.dayName, date: s.date, startedAt: s.startedAt, endedAt: s.startedAt, exercises: s.exercises });
      void flushPending((w) => svc.saveWorkout(w)).then(() => reload());
      showToast({ message: `Saved unfinished ${s.dayName} · ${monthDay(s.date)}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDay = (day: ProgramDay) => {
    if (!program) return;
    // Never overwrite logged work (2026-08-09): if a session with real sets
    // is already going, starting a day RESUMES it instead of destroying it.
    const existing = readLive();
    if (existing && existing.date === todayISO() && hasWork(existing.exercises)) {
      setLive(existing);
      showToast({ message: "Resumed your open workout" });
      return;
    }
    const s: LiveSession = {
      programId: program.id, dayId: day.id, dayName: day.name, date: todayISO(),
      startedAt: Date.now(), idx: 0,
      exercises: day.exercises.map((e) => ({ exerciseId: e.id, name: e.name, kind: e.kind, unit: e.unit, timeUnit: e.timeUnit, sets: [] })),
    };
    writeLive(s);
    setLive(s);
  };
  const update = (next: LiveSession) => { writeLive(next); setLive(next); };

  const finish = async () => {
    if (!live) return;
    const endedAt = Date.now();
    const r = receiptFor(live.exercises, workouts, live.startedAt, endedAt);
    const data = { programId: live.programId, dayId: live.dayId, dayName: live.dayName, date: live.date, startedAt: live.startedAt, endedAt, exercises: live.exercises };
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
  if (viewWorkout) {
    const w = viewWorkout;
    const mins = Math.max(1, Math.round((w.data.endedAt - w.data.startedAt) / 60000));
    return (
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={() => setViewWorkout(null)}></button>
          <div className="nav-title">{w.data.dayName}</div>
          <span className="nav-action"></span>
        </div>
        <div className="grp"><div className="eyebrow">{monthDay(w.data.date)} · {mins} min</div></div>
        <div><div className="list-flat">
          {w.data.exercises.map((e) => (
            <div className="row" key={e.exerciseId}>
              <div className="row-grow">
                <div className="conn-name">{e.name}</div>
                <div className="eyebrow">{e.sets.filter((x) => !x.skipped).length === 0 ? "Skipped" : e.sets.filter((x) => !x.skipped).map((x) => x.done ? "Done" : [x.w ? `${x.w}${e.unit === "kg" ? "kg" : "lb"}` : "", x.r ? `x${x.r}` : "", x.v ? `${x.v}` : ""].filter(Boolean).join("") || "logged").join(" · ")}</div>
              </div>
            </div>
          ))}
        </div></div>
        <div className="pad-x sheet-actions">
          {/* Delete with Undo (2026-08-09): PRs and history derive from the
              workout list, so removing a mislogged session heals every number
              downstream. Same toast contract as every delete in the app. */}
          <button className="btn btn-danger btn-block" onClick={async () => {
            const gone = { ...w.data };
            await svc.removeWorkout(w.id);
            setViewWorkout(null);
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
    const exercise: Exercise | undefined = day?.exercises[live.idx]
      ?? (liveEx ? { id: liveEx.exerciseId, name: liveEx.name, kind: liveEx.kind, unit: liveEx.unit, timeUnit: liveEx.timeUnit, sets: [] } : undefined);
    if (!exercise) return <div className="screen" />;
    return (
      <SessionScreen
        live={live}
        exercise={exercise}
        history={workouts}
        onLog={(s: SetEntry) => update(logSet(live, live.idx, s))}
        onSetLogged={(sets: SetEntry[]) => update(setLoggedSets(live, live.idx, sets))}
        onSkip={() => update({ ...skipExercise(live, live.idx), idx: Math.min(live.idx + 1, live.exercises.length - 1) })}
        onMove={(i) => update({ ...live, idx: i })}
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
    if (sheet.kind === "closed" || !program) return null;
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

  const receiptEl = receipt ? <ReceiptSheet dayName={receipt.dayName} receipt={receipt.receipt} onDone={() => setReceipt(null)} /> : null;

  // ---- day detail: the exercises inside one week's day ----
  if (openDayId && activeWeek) {
    const openDay = activeWeek.days.find((d) => d.id === openDayId) ?? null;
    if (openDay) {
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
              {openDay.exercises.map((e) => (
                <div className="row" role="button" tabIndex={0} key={e.id} onClick={() => setSheet({ kind: "exercise", weekId: activeWeek.id, dayId: openDay.id, exId: e.id })}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{e.name}</div>
                    <div className="eyebrow">{targetLine(e)}</div>
                  </div>
                  {CHEV}
                </div>
              ))}
              <button className="row row-act" onClick={() => setSheet({ kind: "exercise", weekId: activeWeek.id, dayId: openDay.id })}>Add Exercise</button>
            </div></div>
            {openDay.exercises.length > 0 && (
              <div className="pad-x gym-log">
                <button className="btn btn-primary btn-block btn-lg" onClick={() => startDay(openDay)}>Start {openDay.name}</button>
              </div>
            )}
            <div className="screen-foot" />
          </div>
          {sheetEl()}
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
            {activeWeek.days.map((d) => (
              <div className="row" role="button" tabIndex={0} key={d.id} onClick={() => setOpenDayId(d.id)}>
                <div className="row-grow">
                  <div className="conn-name truncate">{d.name}</div>
                  <div className="eyebrow">{d.exercises.length} {d.exercises.length === 1 ? "exercise" : "exercises"}</div>
                </div>
                {CHEV}
              </div>
            ))}
            <button className="row row-act" onClick={() => setSheet({ kind: "day", weekId: activeWeek.id })}>Add Day</button>
          </div></div>
          <div className="pad-x">
            <button className="btn btn-secondary btn-block" onClick={() => setSheet({ kind: "bump", weekId: activeWeek.id })}>Duplicate {activeWeek.label} & Bump</button>
          </div>
          <div className="screen-foot" />
        </div>
        {sheetEl()}
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
          {program && <button className="nav-action-text" onClick={() => setSheet({ kind: "program" })}>Edit</button>}
        </div>

        {!program ? (
          <div className="empty-state">
            <div className="empty-icon">{DUMBBELL}</div>
            <div className="empty-title">No Program Yet</div>
            <button className="btn btn-primary" onClick={() => setSheet({ kind: "program" })}>Create a Program</button>
            {ai.available && <button className="btn btn-secondary" onClick={() => setUploadOpen(true)}>Upload One Instead</button>}
          </div>
        ) : (
          <>
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
                  {(singleWeek?.days ?? []).map((d) => (
                    <div className="row" role="button" tabIndex={0} key={d.id} onClick={() => setOpenDayId(d.id)}>
                      <div className="row-grow">
                        <div className="conn-name truncate">{d.name}</div>
                        <div className="eyebrow">{d.exercises.length} {d.exercises.length === 1 ? "exercise" : "exercises"}</div>
                      </div>
                      {CHEV}
                    </div>
                  ))}
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
                      <div className="row" role="button" tabIndex={0} key={w.id} onClick={() => setViewWorkout(w)}>
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

      {sheet.kind === "program" && (
        <NameSheet
          title={program ? "Edit Program" : "New Program"}
          initial={program?.data.name}
          placeholder="e.g. Push Pull Legs, Summer Speed"
          onSave={async (name) => {
            setSheet({ kind: "closed" });
            if (program) await svc.updateProgram(program.id, { name });
            else await svc.createProgram({ name, weeks: [{ id: nid("w"), label: "Week 1", days: [] }] });
            await reload();
          }}
          onDelete={program ? async () => {
            setSheet({ kind: "closed" });
            await svc.removeProgram(program.id);
            await reload();
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      )}
      {sheetEl()}
      {receiptEl}
    </>
  );
}
