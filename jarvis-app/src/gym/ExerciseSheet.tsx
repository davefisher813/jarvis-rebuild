import { createPortal } from "react-dom";
import { useState } from "react";
import { MEASURE_KINDS, MEASURE_LABEL, unitsFor, defaultUnit, TIME_UNITS, type Exercise, type MeasureKind, type SetEntry, type Workout } from "./types";
import { fieldsFor, targetLine, formatSet, isUniformStrip } from "./measures";
import { uniformStrip, resizeStrip, applyToAll } from "./strip";
import { rampFor } from "./ramp";
import { lastSessionFor } from "./prs";
import { readGymSettings, rackFrom } from "./settings";
import SetStrip from "./SetStrip";
import Stepper from "../shared/Stepper";
import { Trash2 } from "../shared/icons";
import { searchLibrary, newExerciseKey, type LibraryEntry } from "./library";

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
// ONE EDITOR, NOT TWO -- D1 (Training Catalog V2, approved 2026-08-31).
// Dave: "What purpose does the quick set up serve? It makes no sense having
// that and the sets section underneath." The strip is the ONLY editor now:
// a summary row on top speaks the whole plan, and its Edit All Sets
// steppers write count / reps / weight across every chip at once
// (resizeStrip / applyToAll). A new exercise opens with the bulk editor
// expanded so creation stays as fast as the old convenience section ever
// was; that section and its Generate button are gone.
export default function ExerciseSheet({ mode, initial, library, history, onSave, onDelete, onCancel }: {
  mode: "new" | "edit";
  initial?: Exercise;
  /** THE EXERCISE LIBRARY (catalog §3.5): every exercise name ever used,
   *  offered as autocomplete while typing. Optional -- a caller with no
   *  library yet (or a context where it does not apply) just gets a plain
   *  name field, same as before the library existed. */
  library?: LibraryEntry[];
  /** LAST TIME, D2: finished workouts, for the per-chip "Last: 250 × 3"
   *  reference lines. Optional -- with no history the sheet just plans. */
  history?: Workout[];
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
  // The stable identity (catalog §3.5): carried forward when the athlete
  // picks a library suggestion, kept as-is when editing an exercise that
  // already had one, and minted fresh on save otherwise.
  const [exerciseKey, setExerciseKey] = useState<string | undefined>(initial?.exerciseKey);
  const [nameFocused, setNameFocused] = useState(false);
  const [restSec, setRestSec] = useState(initial?.restSec ?? 0);
  const [filler, setFiller] = useState(!!initial?.filler);
  const [ramp, setRamp] = useState(!!initial?.ramp);

  const suggestions = library && nameFocused && name.trim().length > 0
    ? searchLibrary(library, name, 5).filter((s) => s.name.toLowerCase() !== name.trim().toLowerCase())
    : [];

  // ONE EDITOR (D1): the bulk steppers write straight into the strip, so a
  // new exercise opens with them out -- creation stays one glance -- while
  // an edit opens on the chips themselves.
  const [bulkOpen, setBulkOpen] = useState(mode === "new");

  // Picking a suggestion carries kind, unit and the last-used target forward
  // (catalog §3.5) -- exactness, not just proximity, is what stops the fork.
  const pickSuggestion = (entry: LibraryEntry) => {
    setName(entry.name);
    setKind(entry.kind);
    setUnit(entry.unit ?? defaultUnit(entry.kind));
    if (entry.timeUnit) setTimeUnit(entry.timeUnit);
    setExerciseKey(entry.exerciseKey);
    if (entry.lastSets.length > 0) {
      setSets(entry.lastSets.map((s) => ({ ...s, id: `${s.id}p` })));
    }
    setNameFocused(false);
  };

  const pickKind = (k: MeasureKind) => {
    setKind(k);
    setUnit(defaultUnit(k));
    // A leftover weight or time should never ride along onto a new kind: the
    // strip regenerates uniformly, same count, the new kind's own fields.
    setSets((s) => uniformStrip(s.length, k === "done" ? {} : freshTarget(k)));
  };

  const units = unitsFor(kind);
  const fields = fieldsFor(kind);
  const valid = name.trim().length > 0 && sets.length > 0;

  // LAST TIME, D2: the same per-position reference the live session shows,
  // here as quiet planning context ("Last: 250 × 3" under each chip). Reads
  // the name as typed, so picking a library suggestion lights it up.
  const lastHit = history && readGymSettings().showLast && name.trim()
    ? lastSessionFor(history, name.trim(), kind)
    : null;

  const draft: Exercise = {
    id: "draft", name: name.trim() || "Exercise", kind,
    ...(unit ? { unit } : {}),
    ...(kind === "distance_time" ? { timeUnit } : {}),
    sets,
  };
  const saveLabel = kind === "done" ? "Save" : `Save · ${targetLine(draft)}`;
  const rampPreview = ramp ? rampFor(draft, rackFrom(readGymSettings())) : [];

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Exercise" : "Edit Exercise"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input
              className={"input" + (touched && !name.trim() ? " input-error" : "")}
              placeholder="e.g. Barbell Row, 40 Yard Dash"
              value={name}
              // Typing (including renaming an existing exercise) never
              // touches exerciseKey -- a rename must keep the SAME history,
              // which is the entire bug the library exists to fix (catalog
              // §1.3). The key only ever changes by picking a suggestion.
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setNameFocused(true)}
              onBlur={() => setTimeout(() => setNameFocused(false), 150)}
            />
            {touched && !name.trim() && <div className="input-error">Add a name.</div>}
            {/* THE EXERCISE LIBRARY (catalog §3.5): offered the moment there is
                anything to match against. Picking one carries the EXACT name
                forward, which is what stops "Trap Bar Deadlift" and "Trap bar
                DL" from ever becoming two histories in the first place. */}
            {suggestions.length > 0 && (
              <div className="card lib-suggest">
                {suggestions.map((s) => (
                  <div className="row" role="button" tabIndex={0} key={s.key} onMouseDown={() => pickSuggestion(s)}>
                    <div className="row-grow">
                      <div className="conn-name truncate">{s.name}</div>
                      <div className="conn-meta">{MEASURE_LABEL[s.kind]}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            <div className="input-label">{countLabel(kind)}</div>
            {/* ONE EDITOR (D1): the summary row speaks the whole plan; Edit
                All Sets writes count and targets across every chip at once,
                straight into the strip below -- one object, one editor. */}
            <div className="card">
              <div className="row">
                <div className="row-grow">
                  <div className="conn-name">{targetLine(draft)}</div>
                  <div className="conn-meta">{isUniformStrip(kind, sets) ? "Uniform" : "Varies by set"}</div>
                </div>
                {/* The sanctioned in-row pill (.pill-act): tinted verb on a
                    press surface, 44px hit box via its own ::after. */}
                <button className="pill-act" aria-expanded={bulkOpen} onClick={() => setBulkOpen((o) => !o)}>
                  {bulkOpen ? "Done" : "Edit All Sets"}
                </button>
              </div>
              {bulkOpen && (
                <>
                  <div className="row">
                    <div className="row-grow"><div className="conn-name">{countLabel(kind)}</div></div>
                    <Stepper value={sets.length} step={1} min={1} label={countLabel(kind)} onChange={(n) => setSets((s) => resizeStrip(s, n))} />
                  </div>
                  {kind !== "done" && fields.map((f) => (
                    <div className="row" key={f.key}>
                      <div className="row-grow">
                        <div className="conn-name">{f.label}</div>
                        {/* Helper hints are quiet meta, not SHOUTING CAPS (gym
                            reformat 2026-08-31). */}
                        {(f.key === "w" || f.key === "v") && unit && <div className="conn-meta">{unit} · Every set at once</div>}
                        {f.key === "t" && <div className="conn-meta">{timeUnit}</div>}
                      </div>
                      <Stepper value={sets.find((s) => !s.skipped)?.[f.key] ?? 0} step={f.step} label={f.label}
                        onChange={(n) => setSets((s) => applyToAll(kind, s, f.key, n))} />
                    </div>
                  ))}
                  {units.length > 1 && (
                    <div className="row">
                      {/* Same label anatomy as the Weight and Reps rows above --
                          this row was the sheet's odd one out. */}
                      <div className="row-grow"><div className="conn-name">Unit</div></div>
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
                      <div className="row-grow"><div className="conn-name">Time Unit</div></div>
                      <div className="chip-row">
                        {TIME_UNITS.map((u) => (
                          <div key={u} className={"chip" + (timeUnit === u ? " active" : "")} role="button" tabIndex={0} aria-pressed={timeUnit === u}
                            onClick={() => setTimeUnit(u)}>{u}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <SetStrip kind={kind} unit={unit} timeUnit={timeUnit} entries={sets} onChange={setSets}
              lastFor={lastHit ? (i) => (lastHit.sets[i] ? `Last: ${formatSet(lastHit.fx, lastHit.sets[i]!)}` : null) : undefined} />
            {touched && sets.length === 0 && <div className="input-error">Add at least one set.</div>}
          </div>

          <div className="field">
            <div className="input-label">Note</div>
            {/* Reference, never coaching: the app does not tell anyone how to lift. */}
            <input className="input" placeholder="Optional Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>

          {/* REST TIMER (catalog §4.3), optional and per-exercise. 0 means no
              timer offered in-session -- most "done" and reps work has none. */}
          {kind !== "done" && (
            <div className="field">
              <div className="input-label">Rest Timer</div>
              <div className="row">
                <div className="row-grow"><div className="conn-name">{restSec > 0 ? `${Math.floor(restSec / 60)}:${String(restSec % 60).padStart(2, "0")}` : "Off"}</div></div>
                <Stepper value={restSec} step={15} min={0} label="Rest Timer" onChange={setRestSec} />
              </div>
            </div>
          )}

          {/* THE RAMP (D3-A). Warm-up sets are DERIVED from the first working
              weight, never stored here: the plan stays the work, and editing
              the weight re-ramps for free. The preview below is the real
              derivation, so what it says is what the session offers. */}
          {kind === "weight_reps" && (
            <div className="field">
              <div className="input-label">Warm-Up Ramp</div>
              <div className="card">
                <div className="row">
                  <div className="row-grow">
                    <div className="conn-name">{ramp ? "On" : "Off"}</div>
                    <div className="conn-meta">
                      {ramp
                        ? (rampPreview.length
                            ? rampPreview.map((r) => formatSet(draft, r)).join(" · ")
                            : "Nothing to ramp at this weight")
                        : "Build warm-up sets from your first working weight"}
                    </div>
                  </div>
                  <div className={"switch" + (ramp ? "" : " off")} role="switch" aria-checked={ramp} tabIndex={0}
                    onClick={() => setRamp((r) => !r)} />
                </div>
              </div>
            </div>
          )}

          {/* FILLER (catalog §4.2): offered during the rest of whatever it is
              paired with, instead of the athlete standing around. Pairing
              itself is set from the day list's long-press menu, once both
              exercises exist. */}
          <div className="field">
            <div className={"chip" + (filler ? " active" : "")} role="button" tabIndex={0} aria-pressed={filler} onClick={() => setFiller((f) => !f)}>
              {filler ? "This Is a Filler" : "Mark As a Filler"}
            </div>
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
              // A stable identity, never derived from the name: keep the one
              // carried from a picked suggestion or an edited exercise's own
              // key, else mint a fresh one now (catalog §3.5).
              exerciseKey: exerciseKey ?? newExerciseKey(),
              ...(restSec > 0 ? { restSec } : {}),
              ...(filler ? { filler: true } : {}),
              ...(ramp ? { ramp: true } : {}),
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
