import { createPortal } from "react-dom";
import { useState } from "react";
import { MEASURE_KINDS, MEASURE_LABEL, unitsFor, defaultUnit, TIME_UNITS, type Exercise, type MeasureKind } from "./types";
import { fieldsFor, targetLine } from "./measures";
import { StatTiles, type Stat } from "../shared/anatomy";
import Stepper from "../shared/Stepper";

const TRASH = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);


// The count row in the user's language, never "How many" (Dave, 2026-08-15).
const countLabel = (kind: MeasureKind): string => {
  if (kind === "done") return "Times";
  if (kind === "time_faster" || kind === "distance_time") return "Attempts";
  return "Sets";
};

// Any exercise, in the user's words. The kind carries its own direction, so a
// sprint and a plank are both "time" without a separate which-way-wins toggle.
export default function ExerciseSheet({ mode, initial, onSave, onDelete, onCancel }: {
  mode: "new" | "edit";
  initial?: Exercise;
  onSave: (e: Omit<Exercise, "id">) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<MeasureKind>(initial?.kind ?? "weight_reps");
  const [unit, setUnit] = useState<string | undefined>(initial?.unit ?? defaultUnit(initial?.kind ?? "weight_reps"));
  const [timeUnit, setTimeUnit] = useState<string>(initial?.timeUnit ?? "min");
  const [sets, setSets] = useState(initial?.sets ?? 3);
  const [target, setTarget] = useState<{ w?: number; r?: number; v?: number; t?: number }>(initial?.target ?? { w: 0, r: 8 });
  const [note, setNote] = useState(initial?.note ?? "");
  const [touched, setTouched] = useState(false);
  const [armDelete, setArmDelete] = useState(false);

  const pickKind = (k: MeasureKind) => {
    setKind(k);
    setUnit(defaultUnit(k));
    // Reset the target to the new kind's own fields, so a leftover weight
    // never rides along on a sprint.
    const fresh: { w?: number; r?: number; v?: number; t?: number } = {};
    for (const f of fieldsFor(k)) fresh[f.key] = f.key === "r" ? 8 : 0;
    setTarget(fresh);
  };

  const units = unitsFor(kind);
  const fields = fieldsFor(kind);
  const valid = name.trim().length > 0;

  // Live tiles: the plan you are building, readable at a glance while you
  // tap (approved preview 2026-08-15). Tint order: plain, sky, good.
  const TINTS: Stat["tint"][] = ["plain", "sky", "good"];
  const tiles: Stat[] = [
    { num: sets, label: countLabel(kind).toLowerCase(), tint: TINTS[0] },
    ...fields.map((f, i): Stat => ({
      num: target[f.key] ?? 0,
      label: f.key === "w" ? (unit ?? "weight") : f.key === "t" ? timeUnit : f.key === "v" && unit ? unit : f.label.toLowerCase(),
      tint: TINTS[Math.min(i + 1, TINTS.length - 1)],
    })),
  ];

  const draft: Exercise = {
    id: "draft", name: name.trim() || "Exercise", kind, sets,
    ...(unit ? { unit } : {}),
    ...(kind === "distance_time" ? { timeUnit } : {}),
    ...(kind === "done" ? {} : { target }),
  };
  const saveLabel = kind === "done" ? "Save" : `Save · ${targetLine(draft)}`;

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Exercise" : "Edit Exercise"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} placeholder="e.g. Barbell Row, 40 Yard Dash" value={name} onChange={(e) => setName(e.target.value)} />
            {touched && !valid && <div className="input-error">Add a name.</div>}
          </div>

          <div className="field">
            <div className="input-label">What You Track</div>
            <div className="chip-row chip-wrap-row">
              {MEASURE_KINDS.map((k) => (
                <div key={k} className={"chip" + (kind === k ? " active" : "")} role="button" tabIndex={0} aria-pressed={kind === k}
                  onClick={() => pickKind(k)}>{MEASURE_LABEL[k]}</div>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="input-label">Target</div>
            <div className="card">
              {kind !== "done" && <div className="now-stats"><StatTiles stats={tiles} /></div>}
              <div className="row">
                <div className="row-grow"><div className="conn-name">{countLabel(kind)}</div></div>
                <Stepper value={sets} step={1} min={1} label={countLabel(kind)} onChange={setSets} />
              </div>
              {fields.map((f) => (
                <div className="row" key={f.key}>
                  <div className="row-grow">
                    <div className="conn-name">{f.label}</div>
                    {(f.key === "w" || f.key === "v") && unit && <div className="eyebrow">{unit} · Tap number to type</div>}
                    {f.key === "t" && <div className="eyebrow">{timeUnit}</div>}
                  </div>
                  <Stepper value={target[f.key] ?? 0} step={f.step} label={f.label} onChange={(n) => setTarget((t) => ({ ...t, [f.key]: n }))} />
                </div>
              ))}
              {units.length > 1 && (
                <div className="row">
                  <div className="row-grow"><div className="eyebrow">Unit</div></div>
                  <div className="chip-row">
                    {units.map((u) => (
                      <div key={u} className={"chip" + (unit === u ? " active" : "")} role="button" tabIndex={0} aria-pressed={unit === u}
                        onClick={() => setUnit(u)}>{u}</div>
                    ))}
                  </div>
                </div>
              )}
              {kind === "distance_time" && (
                <div className="row">
                  <div className="row-grow"><div className="eyebrow">Time unit</div></div>
                  <div className="chip-row">
                    {TIME_UNITS.map((u) => (
                      <div key={u} className={"chip" + (timeUnit === u ? " active" : "")} role="button" tabIndex={0} aria-pressed={timeUnit === u}
                        onClick={() => setTimeUnit(u)}>{u}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="field">
            <div className="input-label">Note</div>
            {/* Reference, never coaching: the app does not tell anyone how to lift. */}
            <input className="input" placeholder="Optional Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={() => {
            if (!valid) { setTouched(true); return; }
            onSave({
              name: name.trim(), kind, sets,
              ...(unit ? { unit } : {}),
              ...(kind === "distance_time" ? { timeUnit } : {}),
              ...(kind === "done" ? {} : { target }),
              ...(note.trim() ? { note: note.trim() } : {}),
            });
          }}>{saveLabel}</button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
          {mode === "edit" && onDelete && (
            !armDelete
              ? <button className="btn btn-secondary btn-block btn-danger-text" onClick={() => setArmDelete(true)}>{TRASH}Delete Exercise</button>
              : <button className="btn btn-danger btn-block" onClick={onDelete}>Tap Again to Confirm</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
