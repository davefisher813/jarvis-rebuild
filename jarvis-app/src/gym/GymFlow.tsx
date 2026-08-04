import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useGym } from "../data/NotesProvider";
import { todayISO } from "../tasks/grouping";
import { monthDay } from "../money/bills";
import type { Exercise, Program, ProgramDay, Workout, SetLog } from "./types";
import { targetLine } from "./measures";
import { receiptFor, type Receipt } from "./prs";
import { readLive, writeLive, clearLive, logSet, undoLast, skipExercise, queueFinished, flushPending, hasWork, type LiveSession } from "./liveSession";
import ExerciseSheet from "./ExerciseSheet";
import SessionScreen from "./SessionScreen";
import ReceiptSheet from "./ReceiptSheet";
import UploadFlow from "./UploadFlow";
import HistoryScreen from "./HistoryScreen";
import { usePushDepth } from "../shared/pushNav";
import { showToast } from "../shared/toast";
import { useAI } from "../ai/useAI";

const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const DUMBBELL = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6.5 6.5 11 11" /><path d="m21 21-1-1" /><path d="m3 3 1 1" /><path d="m18 22 4-4" /><path d="m2 6 4-4" /><path d="m3 10 7-7" /><path d="m14 21 7-7" /></svg>
);

let seq = 0;
const nid = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

function NameSheet({ title, initial, placeholder, onSave, onDelete, onCancel }: {
  title: string; initial?: string; placeholder: string;
  onSave: (v: string) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [v, setV] = useState(initial ?? "");
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
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => v.trim() && onSave(v.trim())}>Save</button>
          {onDelete && <button className="btn btn-danger btn-block" onClick={onDelete}>Delete</button>}
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
  | { kind: "day"; dayId?: string }
  | { kind: "exercise"; dayId: string; exId?: string };

// The gym track, session 1: programs in the user's own words, the in-gym loop,
// live PRs, and an honest receipt. Upload (needs vision) and the history page
// are session 2.
export default function GymFlow({ onBack }: { onBack: () => void }) {
  const svc = useGym();
  const ai = useAI();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [openDayId, setOpenDayId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveSession | null>(null);
  const [receipt, setReceipt] = useState<{ receipt: Receipt; dayName: string } | null>(null);
  const [sheet, setSheet] = useState<Sheet>({ kind: "closed" });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const program = programs[0] ?? null; // v1: one program at a time

  const reload = useCallback(async () => {
    // Anything logged offline lands as soon as a write succeeds.
    await flushPending((w) => svc.saveWorkout(w));
    const [ps, ws] = await Promise.all([svc.listPrograms(), svc.listWorkouts()]);
    setPrograms(ps);
    setWorkouts(ws);
    setLive(readLive());
  }, [svc]);
  useEffect(() => { void reload(); }, [reload]);

  usePushDepth(live ? 2 : openDayId || historyOpen || uploadOpen ? 1 : 0);

  // Upload (gym session 2): photo/screenshot or pasted text -> review -> save.
  // Gated on AI availability like every AI-dependent offer.
  const saveUploaded = async (p: { name: string; days: Program["data"]["days"] }) => {
    setUploadOpen(false);
    if (program) {
      // Merge into the one program: uploaded days append after existing ones.
      await svc.updateProgram(program.id, { name: p.name, days: [...program.data.days, ...p.days] });
    } else {
      await svc.createProgram({ name: p.name, days: p.days });
    }
    await reload();
    showToast({ message: "Program saved. Check the days over once before you train." });
  };

  const saveDays = async (days: ProgramDay[]) => {
    if (!program) return;
    await svc.updateProgram(program.id, { days });
    await reload();
  };

  // ---- in-gym ----
  const startDay = (day: ProgramDay) => {
    if (!program) return;
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
    // Land on the program page, not back on the day: the day detail is a dead
    // end after a session, while the program page shows what just happened and
    // what is next.
    setOpenDayId(null);
    if (hasWork(live.exercises)) {
      // Queue first, then try: a failed write must never lose the session.
      queueFinished(data);
      await flushPending((w) => svc.saveWorkout(w));
      setReceipt({ receipt: r, dayName: live.dayName });
    } else {
      showToast({ message: "Nothing logged, so nothing saved." });
    }
    await reload();
  };

  if (uploadOpen) {
    return <UploadFlow ai={ai} onSave={(p) => void saveUploaded(p)} onCancel={() => setUploadOpen(false)} />;
  }
  if (historyOpen) {
    return <HistoryScreen workouts={workouts} onBack={() => setHistoryOpen(false)} />;
  }
  if (live) {
    const day = program?.data.days.find((d) => d.id === live.dayId);
    const exercise: Exercise | undefined = day?.exercises[live.idx]
      ?? (live.exercises[live.idx] ? { id: live.exercises[live.idx]!.exerciseId, name: live.exercises[live.idx]!.name, kind: live.exercises[live.idx]!.kind, unit: live.exercises[live.idx]!.unit, sets: 3 } : undefined);
    if (!exercise) return <div className="screen" />;
    return (
      <>
        <SessionScreen
          live={live}
          exercise={exercise}
          history={workouts}
          onLog={(s: SetLog) => update(logSet(live, live.idx, s))}
          onUndo={() => update(undoLast(live, live.idx))}
          onSkip={() => update({ ...skipExercise(live, live.idx), idx: Math.min(live.idx + 1, live.exercises.length - 1) })}
          onMove={(i) => update({ ...live, idx: i })}
          onFinish={() => void finish()}
          onBack={() => setLive(null)}
        />
      </>
    );
  }

  const openDay = openDayId ? program?.data.days.find((d) => d.id === openDayId) ?? null : null;

  // The receipt must be mounted on EVERY branch: starting a session from the
  // day page and finishing there used to return before it rendered, so the
  // whole payoff moment silently never happened (caught by the live walk).
  const receiptEl = receipt ? <ReceiptSheet dayName={receipt.dayName} receipt={receipt.receipt} onDone={() => setReceipt(null)} /> : null;

  if (openDay) {
    return (
      <>
        <div className="screen">
          <div className="nav-bar">
            <button className="nav-back" aria-label="Back" onClick={() => setOpenDayId(null)}></button>
            <div className="nav-title truncate">{openDay.name}</div>
            <button className="nav-action-text" onClick={() => setSheet({ kind: "day", dayId: openDay.id })}>Edit</button>
          </div>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Exercises</div></div></div>
          <div className="pad-x"><div className="card">
            {openDay.exercises.map((e) => (
              <div className="row" role="button" tabIndex={0} key={e.id} onClick={() => setSheet({ kind: "exercise", dayId: openDay.id, exId: e.id })}>
                <div className="row-grow">
                  <div className="conn-name truncate">{e.name}</div>
                  <div className="eyebrow">{targetLine(e)}</div>
                </div>
                {CHEV}
              </div>
            ))}
            <div className="row ob-addrow" role="button" tabIndex={0} onClick={() => setSheet({ kind: "exercise", dayId: openDay.id })}>
              <div className="sec-ico ico-accent">{PLUS}</div>
              <div className="row-grow"><div className="conn-name">Add Exercise</div></div>
            </div>
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

  const recent = [...workouts].reverse().slice(0, 5);
  const nextDay = (() => {
    if (!program || program.data.days.length === 0) return null;
    const last = recent[0];
    if (!last) return program.data.days[0]!;
    const i = program.data.days.findIndex((d) => d.id === last.data.dayId);
    return program.data.days[(i + 1) % program.data.days.length] ?? program.data.days[0]!;
  })();

  function sheetEl() {
    if (sheet.kind === "closed" || !program) return null;
    if (sheet.kind === "day") {
      const existing = sheet.dayId ? program.data.days.find((d) => d.id === sheet.dayId) : undefined;
      return (
        <NameSheet
          title={existing ? "Edit Day" : "New Day"}
          initial={existing?.name}
          placeholder="e.g. Pull, Speed Work, Tuesday"
          onSave={async (name) => {
            const days = existing
              ? program.data.days.map((d) => (d.id === existing.id ? { ...d, name } : d))
              : [...program.data.days, { id: nid("d"), name, exercises: [] }];
            setSheet({ kind: "closed" });
            await saveDays(days);
          }}
          onDelete={existing ? async () => {
            setSheet({ kind: "closed" });
            if (openDayId === existing.id) setOpenDayId(null);
            await saveDays(program.data.days.filter((d) => d.id !== existing.id));
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    if (sheet.kind === "exercise") {
      const day = program.data.days.find((d) => d.id === sheet.dayId);
      const existing = sheet.exId ? day?.exercises.find((e) => e.id === sheet.exId) : undefined;
      return (
        <ExerciseSheet
          mode={existing ? "edit" : "new"}
          initial={existing}
          onSave={async (draft) => {
            const days = program.data.days.map((d) => {
              if (d.id !== sheet.dayId) return d;
              const exercises = existing
                ? d.exercises.map((e) => (e.id === existing.id ? { ...draft, id: existing.id } : e))
                : [...d.exercises, { ...draft, id: nid("e") }];
              return { ...d, exercises };
            });
            setSheet({ kind: "closed" });
            await saveDays(days);
          }}
          onDelete={existing ? async () => {
            const days = program.data.days.map((d) => (d.id === sheet.dayId ? { ...d, exercises: d.exercises.filter((e) => e.id !== existing.id) } : d));
            setSheet({ kind: "closed" });
            await saveDays(days);
          } : undefined}
          onCancel={() => setSheet({ kind: "closed" })}
        />
      );
    }
    return null;
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
            <div className="empty-title">No program yet</div>
            <button className="btn btn-primary" onClick={() => setSheet({ kind: "program" })}>Create a Program</button>
            {ai.available && <button className="btn btn-secondary" onClick={() => setUploadOpen(true)}>Upload One Instead</button>}
          </div>
        ) : (
          <>
            {nextDay && nextDay.exercises.length > 0 && (
              <div className="pad-x"><div className="card pad">
                <div className="conn-name">Next: {nextDay.name}</div>
                <div className="bp-sub">{nextDay.exercises.length} {nextDay.exercises.length === 1 ? "exercise" : "exercises"}{recent[0] ? ` · last trained ${monthDay(recent[0].data.date)}` : ""}</div>
                <div className="offer-row">
                  <button className="btn btn-primary" onClick={() => startDay(nextDay)}>Start {nextDay.name}</button>
                </div>
              </div></div>
            )}

            <div className="sec-head"><div className="sec-left"><div className="sec-title">Days</div></div></div>
            <div className="pad-x"><div className="card">
              {program.data.days.map((d) => (
                <div className="row" role="button" tabIndex={0} key={d.id} onClick={() => setOpenDayId(d.id)}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{d.name}</div>
                    <div className="eyebrow">{d.exercises.length} {d.exercises.length === 1 ? "exercise" : "exercises"}</div>
                  </div>
                  {CHEV}
                </div>
              ))}
              <div className="row ob-addrow" role="button" tabIndex={0} onClick={() => setSheet({ kind: "day" })}>
                <div className="sec-ico ico-accent">{PLUS}</div>
                <div className="row-grow"><div className="conn-name">Add Day</div></div>
              </div>
              {ai.available && (
                <div className="row" role="button" tabIndex={0} onClick={() => setUploadOpen(true)}>
                  <div className="row-grow"><div className="conn-name">Upload a Program</div></div>
                  {CHEV}
                </div>
              )}
            </div></div>

            {recent.length > 0 && (
              <>
                <div className="sec-head">
                  <div className="sec-left"><div className="sec-title">Recent</div></div>
                  <button className="see-all" onClick={() => setHistoryOpen(true)}>History</button>
                </div>
                <div className="pad-x"><div className="card">
                  {recent.map((w) => {
                    const logged = w.data.exercises.filter((e) => e.sets.some((s) => !s.skipped)).length;
                    const total = w.data.exercises.length;
                    const mins = Math.max(1, Math.round((w.data.endedAt - w.data.startedAt) / 60000));
                    return (
                      <div className="row" key={w.id}>
                        <div className="row-grow">
                          <div className="conn-name truncate">{w.data.dayName}</div>
                          {/* Partial work is stated as the fact it is: never a
                              percentage, never a shortfall. */}
                          <div className="eyebrow">{monthDay(w.data.date)} · {mins} min · {logged === total ? `${total} ${total === 1 ? "exercise" : "exercises"}` : `${logged} of ${total} exercises`}</div>
                        </div>
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
            else await svc.createProgram({ name, days: [] });
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
