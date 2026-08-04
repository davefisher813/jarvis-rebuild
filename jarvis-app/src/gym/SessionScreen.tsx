import { useState } from "react";
import type { Exercise, SetLog, Workout } from "./types";
import type { LiveSession } from "./liveSession";
import { formatSet, logButtonLabel, targetSet, entryNoun, fieldsFor } from "./measures";
import { isPR, lastTimeLine } from "./prs";

const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);

function Stepper({ value, step, onChange }: { value: number; step: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Less" onClick={() => onChange(Math.max(0, Number((value - step).toFixed(2))))}>&minus;</button>
      <div className="sep" />
      <div className="val">{value}</div>
      <div className="sep" />
      <button type="button" aria-label="More" onClick={() => onChange(Number((value + step).toFixed(2)))}>+</button>
    </div>
  );
}

// The in-gym screen. ONE exercise, huge type, readable from a bench, because
// standing there scrolling is the moment self-consciousness eats people. The
// big button carries the real numbers so a set that matched the plan is one
// tap; steppers appear only for deviation.
export default function SessionScreen({
  live,
  exercise,
  history,
  onLog,
  onUndo,
  onSkip,
  onMove,
  onFinish,
  onBack,
}: {
  live: LiveSession;
  exercise: Exercise;
  history: Workout[];
  onLog: (s: SetLog) => void;
  onUndo: () => void;
  onSkip: () => void;
  onMove: (idx: number) => void;
  onFinish: () => void;
  onBack: () => void;
}) {
  const idx = live.idx;
  const current = live.exercises[idx]!;
  const [dev, setDev] = useState<SetLog | null>(null);
  const plan = targetSet(exercise);
  const pending = dev ?? plan;
  const fields = fieldsFor(exercise.kind);
  const noun = entryNoun(exercise.kind);
  const last = lastTimeLine(history, exercise.name, exercise.kind);
  const logged = current.sets;

  const log = () => {
    onLog(exercise.kind === "done" ? {} : pending);
    setDev(null);
  };

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title truncate">{live.dayName}</div>
        <button className="nav-action-text" onClick={onFinish}>Finish</button>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="eyebrow">Exercise {idx + 1} of {live.exercises.length}</div>
        <div className="p3-q">{exercise.name}</div>
        {last && <div className="bp-sub">{last}</div>}
        {exercise.note && <div className="bp-sub">{exercise.note}</div>}
      </div></div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">{noun}</div></div></div>
      <div className="pad-x"><div className="card">
        {logged.map((s, i) => (
          <div className="row" key={i}>
            <div className="task-check done" />
            <div className="row-grow"><div className="conn-name">{formatSet(exercise, s)}</div></div>
            {/* The PR moment happens HERE, mid-session, not buried in a stats
                tab weeks later. That timing is the whole trick. */}
            {isPR(history, exercise.name, exercise.kind, s) && <span className="pill pill-good">PR</span>}
          </div>
        ))}
        {!current.skipped && logged.length < exercise.sets && (
          <div className="row">
            <div className={"task-check cat-bd-green"} />
            <div className="row-grow">
              <div className="conn-name">{entryNoun(exercise.kind, false)} {logged.length + 1} of {exercise.sets}</div>
              {exercise.kind !== "done" && <div className="eyebrow">Target {formatSet(exercise, plan)}</div>}
            </div>
          </div>
        )}
        {current.skipped && (
          <div className="row"><div className="row-grow"><div className="conn-name">Skipped</div></div></div>
        )}
      </div></div>

      {!current.skipped && (
        <div className="pad-x gym-log">
          <button className="btn btn-primary btn-block btn-lg" onClick={log}>
            {dev ? `Log ${formatSet(exercise, dev)}` : logButtonLabel(exercise)}
          </button>
        </div>
      )}

      {(fields.length > 0 || logged.length > 0) && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Something Different</div></div></div>
          <div className="pad-x"><div className="card">
            {fields.map((f) => (
              <div className="row" key={f.key}>
                <div className="row-grow">
                  <div className="conn-name">{f.label}</div>
                  {(f.key === "w" || f.key === "v") && exercise.unit && <div className="eyebrow">{exercise.unit}</div>}
                  {f.key === "t" && <div className="eyebrow">{exercise.timeUnit ?? "min"}</div>}
                </div>
                <Stepper value={(pending as Record<string, number | undefined>)[f.key] ?? 0} step={f.step}
                  onChange={(n) => setDev({ ...pending, [f.key]: n })} />
              </div>
            ))}
            {logged.length > 0 && (
              <div className="row" role="button" tabIndex={0} onClick={onUndo}>
                <div className="row-grow"><div className="conn-name">Undo Last {entryNoun(exercise.kind, false)}</div></div>
              </div>
            )}
            {!current.skipped && (
              <div className="row" role="button" tabIndex={0} onClick={onSkip}>
                <div className="row-grow"><div className="conn-name">Skip This Exercise</div></div>
                {CHEV}
              </div>
            )}
          </div></div>
        </>
      )}

      <div className="sec-head"><div className="sec-left"><div className="sec-title">This Session</div></div></div>
      <div className="pad-x"><div className="card">
        {live.exercises.map((e, i) => (
          <div className={"row" + (i === idx ? " ob-addrow" : "")} role="button" tabIndex={0} key={e.exerciseId + i} onClick={() => onMove(i)}>
            <div className="row-grow">
              <div className="conn-name truncate">{e.name}</div>
              <div className="eyebrow">{e.skipped ? "Skipped" : e.sets.length > 0 ? `${e.sets.length} logged` : "Not started"}</div>
            </div>
            {CHEV}
          </div>
        ))}
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
