import { createPortal } from "react-dom";
import { useState } from "react";
import { MEASURE_KINDS, MEASURE_LABEL, unitsFor, defaultUnit, TIME_UNITS, type Exercise, type MeasureKind, type SetEntry } from "./types";
import { fieldsFor, targetLine } from "./measures";
import { uniformStrip } from "./strip";
import SetStrip from "./SetStrip";
import Stepper from "../shared/Stepper";
import { Trash2 } from "../shared/icons";

// The count row in the user's language, never "How many" (Dave, 2026-08-15).
const countLabel = (kind: MeasureKind): string => {
  if (kind === "done") return "Times";
  if (kind === "time_faster" || kind === "distance_time") return "Attempts";
  return "Sets";
};

function freshTarget(kind: MeasureKind): { w?: number; r?: number; v?: number; t?: number } {
  const fresh: { w?: number; r?: number; v?: number; t?: number } = {};
  for (const f of fieldsFor(kind)) fresh[f.key] = f.key === "r" ? 8 : 0;
  return fresh;
}

// Any exercise, in the user's words. The kind carries its own direction, so a
// sprint and a plank are both "time" without a separate which-way-wins toggle.
//
// THE SET STRIP (catalog §3.1): the actual storage is `sets: SetEntry[]`, one
// chip per set. "Quick Setup" below is the CONVENIENCE INPUT the catalog's
// open question 6 resolved for: typing a count and one target once expands
// into a uniform strip, which the strip then lets you edit set by set.
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
  const [sets, setSets] = useState<SetEntry[]>(initial?.sets ?? uniformStrip(3, { r: 8 }));
  const [note, setNote] = useState(initial?.note ?? "");
  const [touched, setTouched] = useState(false);
  const [armDelete, setArmDelete] = useState(false);

  // Quick Setup state: independent of the strip until "Generate" is tapped,
  // so it never silently clobbers a set you already hand-edited.
  const [quickCount, setQuickCount] = useState(initial?.sets.length ?? 3);
  const [quickTarget, setQuickTarget] = useState<{ w?: number; r?: number; v?: number; t?: number }>(
    initial?.sets[0] ?? freshTarget(kind));

  const pickKind = (k: MeasureKind) => {
    setKind(k);
    setUnit(defaultUnit(k));
    const fresh = freshTarget(k);
    setQuickTarget(fresh);
    // A leftover weight or time should never ride along onto a new kind: the
    // strip regenerates uniformly, same count, the new kind's own fields.
    setSets(uniformStrip(quickCount, k === "done" ? {} : fresh));
  };

  const generate = () => {
    setSets(uniformStrip(quickCount, kind === "done" ? {} : quickTarget));
  };

  const units = unitsFor(kind);
  const fields = fieldsFor(kind);
  const valid = name.trim().length > 0 && sets.length > 0;

  const draft: Exercise = {
    id: "draft", name: name.trim() || "Exercise", kind,
    ...(unit ? { unit } : {}),
    ...(kind === "distance_time" ? { timeUnit } : {}),
    sets,
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
            <input className={"input" + (touched && !name.trim() ? " input-error" : "")} placeholder="e.g. Barbell Row, 40 Yard Dash" value={name} onChange={(e) => setName(e.target.value)} />
            {touched && !name.trim() && <div className="input-error">Add a name.</div>}
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
            <div className="input-label">Quick Setup</div>
            <div className="card">
              <div className="row">
                <div className="row-grow"><div className="conn-name">{countLabel(kind)}</div></div>
                <Stepper value={quickCount} step={1} min={1} label={countLabel(kind)} onChange={setQuickCount} />
              </div>
              {kind !== "done" && fields.map((f) => (
                <div className="row" key={f.key}>
                  <div className="row-grow">
                    <div className="conn-name">{f.label}</div>
                    {(f.key === "w" || f.key === "v") && unit && <div className="eyebrow">{unit} · Tap number to type</div>}
                    {f.key === "t" && <div className="eyebrow">{timeUnit}</div>}
                  </div>
                  <Stepper value={quickTarget[f.key] ?? 0} step={f.step} label={f.label} onChange={(n) => setQuickTarget((t) => ({ ...t, [f.key]: n }))} />
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
              <button className="row row-act" onClick={generate}>
                {kind === "done" ? `Generate ${quickCount} Identical ${quickCount === 1 ? "Time" : "Times"}` : "Generate Identical Sets"}
              </button>
            </div>
          </div>

          <div className="field">
            <div className="input-label">Sets</div>
            <SetStrip kind={kind} unit={unit} timeUnit={timeUnit} entries={sets} onChange={setSets} />
            {touched && sets.length === 0 && <div className="input-error">Add at least one set.</div>}
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
              ...(note.trim() ? { note: note.trim() } : {}),
            });
          }}>{saveLabel}</button>
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
          {mode === "edit" && onDelete && (
            !armDelete
              ? <button className="btn btn-secondary btn-block btn-danger-text" onClick={() => setArmDelete(true)}><Trash2 className="ic" />Delete Exercise</button>
              : <button className="btn btn-danger btn-block" onClick={onDelete}>Tap Again to Confirm</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
