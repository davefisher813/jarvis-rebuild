import { createPortal } from "react-dom";
import { useState } from "react";
import type { GoalData } from "../life/types";
import type { MeasureKind } from "./types";
import type { LiftMeasure, TrainingMeasure, TrainingCadence } from "./goalMeasures";
import { fieldsFor, has } from "./measures";
import Stepper from "../shared/Stepper";

// A GOAL ON THE BAR, D12-A/C (Training Catalog V2, approved 2026-08-31). Set
// from the gym, because this is the one sheet that knows how to pick an
// exercise and a target set -- life/GoalSheet.tsx does not, and deliberately
// carries a lift/training goal through unedited rather than guessing at one
// (see its own comment). Health tags are added HERE, silently, by the
// caller passing `healthCategoryIds` -- "goal creation in the gym surfaces
// automatically in Bigger Picture under Health... zero new grouping UI"
// means no tag picker belongs in this sheet at all.

type Mode = "lift" | "training";

export default function LiftGoalSheet({
  exercise, exerciseKey, kind, unit, timeUnit, initial, healthCategoryIds, onSave, onDelete, onCancel,
}: {
  exercise: string;
  /** GYM-F-04 (2026-09-05): stamped onto the measure so the goal follows the
   *  lift through a rename instead of quietly watching a name nobody uses any
   *  more. Absent for a lift that predates the library. */
  exerciseKey?: string;
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  initial?: { title: string; measure?: LiftMeasure | TrainingMeasure; by?: string };
  healthCategoryIds: string[];
  onSave: (data: GoalData) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const initialMode: Mode = initial?.measure?.kind === "training" ? "training" : "lift";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [touched, setTouched] = useState(false);
  const [by, setBy] = useState(initial?.by ?? "");

  // Lift target fields.
  const liftInit = initial?.measure?.kind === "lift" ? initial.measure : undefined;
  const [w, setW] = useState(liftInit?.target.w ?? (kind === "weight_reps" ? 45 : 0));
  const [r, setR] = useState(liftInit?.target.r ?? (kind === "weight_reps" || kind === "reps" || kind === "rounds" ? 5 : 0));
  const [v, setV] = useState(liftInit?.target.v ?? 0);
  const [t, setT] = useState(liftInit?.target.t ?? 0);

  // Training fields.
  const trainInit = initial?.measure?.kind === "training" ? initial.measure : undefined;
  const [per, setPer] = useState<TrainingCadence>(trainInit?.per ?? "block");
  const [times, setTimes] = useState(trainInit?.times ?? 3);
  const [scoped, setScoped] = useState(trainInit ? !!trainInit.exercise : true);

  // GYM-F-20 (2026-09-05): the old expression collapsed to title-only
  // (`(mode === "training" || kind === "weight_reps" ? true : true)`), so a
  // goal saved with the stepper untouched carried a target of 0. On Vertical
  // Jump that read "0 In -- hit it" at 100% and the next session's receipt
  // celebrated a Goal Hit; on a sprint the same 0 could never be met at all.
  // Every field this kind actually asks for has to carry a real number.
  const targetFields: Record<"w" | "r" | "v" | "t", number> = { w, r, v, t };
  const targetGiven = fieldsFor(kind).every((f) => has(targetFields[f.key]));
  const valid = title.trim().length > 0 && (mode === "training" ? times >= 1 : targetGiven);
  // Double-tapping Save used to create two goals: the write is async and
  // nothing disarmed the button while it ran.
  const [saving, setSaving] = useState(false);
  // GYM-F-28 (2026-09-05): Delete Goal is irreversible, so it arms first.
  // It used to fire on the first tap, which was safe only because no caller
  // ever passed onDelete and the button never rendered.
  const [armDelete, setArmDelete] = useState(false);

  const measureOf = (): LiftMeasure | TrainingMeasure => {
    if (mode === "training") {
      return {
        kind: "training", per, times: Math.max(1, times),
        ...(per === "block" ? { since: trainInit?.since ?? todayISO() } : {}),
        ...(scoped ? { exercise, ...(exerciseKey ? { exerciseKey } : {}) } : {}),
      };
    }
    const target: LiftMeasure["target"] =
      kind === "weight_reps" ? { w, r }
      : kind === "reps" || kind === "rounds" ? { r }
      : kind === "distance_time" ? { v, t }
      : { v }; // time_faster, time_longer, distance, height
    return { kind: "lift", exercise, ...(exerciseKey ? { exerciseKey } : {}), measureKind: kind, target, ...(unit ? { unit } : {}), ...(timeUnit ? { timeUnit } : {}) };
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{initial ? "Edit Goal" : "New Goal"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Goal</div>
            <input className={"input" + (touched && !title.trim() ? " input-error" : "")} placeholder={`e.g. ${exercise} Target`} value={title} onChange={(e) => setTitle(e.target.value)} />
            {touched && !title.trim() && <div className="input-error">Add a goal.</div>}
          </div>
          <div className="field">
            <div className="input-label">Kind</div>
            <div className="segmented">
              <button className={"seg" + (mode === "lift" ? " active" : "")} onClick={() => setMode("lift")}>On the Bar</button>
              <button className={"seg" + (mode === "training" ? " active" : "")} onClick={() => setMode("training")}>Training</button>
            </div>
          </div>

          {mode === "lift" && kind === "weight_reps" && (
            <div className="field">
              <div className="input-label">Target</div>
              <div className="row"><div className="row-grow"><div className="conn-name">{w} {unit ?? "lb"}</div></div><Stepper value={w} step={5} min={0} label="Weight" onChange={setW} /></div>
              <div className="row"><div className="row-grow"><div className="conn-name">{r} reps</div></div><Stepper value={r} step={1} min={1} label="Reps" onChange={setR} /></div>
              <div className="input-hint">Hitting it once, at that weight and rep floor, is the celebration.</div>
            </div>
          )}
          {mode === "lift" && (kind === "reps" || kind === "rounds") && (
            <div className="field">
              <div className="input-label">Target</div>
              <div className="row"><div className="row-grow"><div className="conn-name">{r} {kind === "rounds" ? "rounds" : "reps"}</div></div><Stepper value={r} step={1} min={1} label="Target" onChange={setR} /></div>
            </div>
          )}
          {mode === "lift" && (kind === "time_faster" || kind === "time_longer" || kind === "distance" || kind === "height") && (
            <div className="field">
              <div className="input-label">Target</div>
              <div className="row"><div className="row-grow"><div className="conn-name">{v} {unit ?? timeUnit ?? ""}</div></div><Stepper value={v} step={kind === "time_faster" || kind === "time_longer" ? 0.5 : 1} min={0} label="Target" onChange={setV} /></div>
            </div>
          )}
          {mode === "lift" && kind === "distance_time" && (
            <div className="field">
              <div className="input-label">Target</div>
              <div className="row"><div className="row-grow"><div className="conn-name">{v} {unit ?? ""}</div></div><Stepper value={v} step={1} min={0} label="Distance" onChange={setV} /></div>
              <div className="row"><div className="row-grow"><div className="conn-name">{t} {timeUnit ?? "min"}</div></div><Stepper value={t} step={0.5} min={0} label="Time" onChange={setT} /></div>
            </div>
          )}

          {/* GYM-F-20: a target of zero is not a target, and the sheet says
              which number is missing rather than refusing in silence. */}
          {mode === "lift" && touched && !targetGiven && (
            <div className="input-error">Set a target above zero.</div>
          )}

          {mode === "training" && (
            <div className="field">
              <div className="input-label">Rhythm</div>
              <div className="segmented">
                <button className={"seg" + (per === "block" ? " active" : "")} onClick={() => setPer("block")}>This Block</button>
                <button className={"seg" + (per === "week" ? " active" : "")} onClick={() => setPer("week")}>A Week</button>
                <button className={"seg" + (per === "month" ? " active" : "")} onClick={() => setPer("month")}>A Month</button>
              </div>
              <div className="row field-gap"><div className="row-grow"><div className="conn-name">{times} sessions</div></div><Stepper value={times} step={1} min={1} label="Sessions" onChange={setTimes} /></div>
              <div className="field-gap">
                <div className={"chip" + (scoped ? " active" : "")} role="button" tabIndex={0} onClick={() => setScoped((s) => !s)}>
                  {scoped ? `Only ${exercise}` : "Any Session Counts"}
                </div>
              </div>
              <div className="input-hint">Counted, never a streak. A missed week is just a missed week.</div>
            </div>
          )}

          <div className="field">
            <div className="input-label">Wanted By</div>
            <input type="date" className="input" value={by} onChange={(e) => setBy(e.target.value)} />
            <div className="input-hint">Optional.</div>
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-launch btn-block" disabled={saving} onClick={() => {
            if (!valid) { setTouched(true); return; }
            if (saving) return;
            setSaving(true);
            onSave({
              title: title.trim(), state: "on_track",
              ...(healthCategoryIds.length ? { tags: healthCategoryIds } : {}),
              measure: measureOf(),
              by: by || undefined,
            });
          }}>Save</button>
          {onDelete && (
            <button className={"btn btn-block " + (armDelete ? "btn-danger" : "btn-secondary btn-danger-text")}
              onClick={() => (armDelete ? onDelete() : setArmDelete(true))}>
              {armDelete ? "Tap Again to Delete" : "Delete Goal"}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
