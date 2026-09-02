import { createPortal } from "react-dom";
import { useState, type ReactNode } from "react";
import { MEASURE_KINDS, MEASURE_LABEL, unitsFor, defaultUnit, TIME_UNITS, COND_FORMATS, COND_LABEL, type CondBlock, type CondFormat, type Exercise, type MeasureKind, type SetEntry, type Workout } from "./types";
import { condCap, condSummary, mmss } from "./conditioning";
import { fieldsFor, targetLine, formatSet, isUniformStrip } from "./measures";
import { uniformStrip, resizeStrip, applyToAll } from "./strip";
import { rampFor } from "./ramp";
import { lastSessionFor } from "./prs";
import { readGymSettings, rackFrom } from "./settings";
import SetStrip from "./SetStrip";
import Stepper from "../shared/Stepper";
import SheetBar from "../shared/SheetBar";
import HeadMenu from "../shared/HeadMenu";
import { Trash2, Gauge, Timer, PersonStanding, Hourglass, Flame, Shuffle, StickyNote } from "../shared/icons";
import { searchLibrary, newExerciseKey, type LibraryEntry } from "./library";
import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "./muscles";

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

// THE ROW'S TILE (Fewer Buttons, Dave 2026-09-02: "Add a little color or
// something to the exercise page too"). Each row of the table leads with
// the glyph that names it in a coloured tile, iOS Settings' own anatomy
// (shared/anatomy's .row-ico and the nav-tile palette), one hue per row so
// the eye lands on Clock or Rest without reading. Colour on the tile only;
// the words stay in the row's ink.
function Tile({ tone, children }: { tone: string; children: ReactNode }) {
  return <div className={"row-ico nav-tile-" + tone}>{children}</div>;
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
//
// A GROUPED TABLE, NOT A FORM OF PILLS (Fewer Buttons, Dave 2026-09-02:
// "the workout exercise modal has way too many pills as well. I also hate
// the entire design it looks outdated now compared to the rest of the
// app"; picked "iOS grouped rows, value on the right"). Counted on his
// screenshot: nine kind chips, five clock chips, a filler chip, eight
// muscle chips, plus a stepper card and a switch card. Every chip row is
// one row now that states its current value, and the value opens a menu
// (shared/HeadMenu, the Tasks head's own dropdown). Four groups: Sets (the
// summary row, the bulk editor, the strip), Tracks (Measure, Clock, Muscle),
// In the Session (Rest Timer, Warm-Up Ramp, Filler), Note. The header is
// the ruled sheet bar (Cancel, the name, Save); Delete sits alone at the
// very bottom. The set strip keeps its chips, which he approved.
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
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup | undefined>(initial?.muscleGroup);
  // THE CONDITIONING BLOCK (ruled 2026-09-01, built 2026-09-02). Off means
  // this is a strip; a format makes it a clock. The kind follows the format
  // (an AMRAP scores rounds, a For Time scores time, EMOM and Tabata count
  // the intervals they complete), so the athlete never has to know that.
  const [condFormat, setCondFormat] = useState<CondFormat | null>(initial?.cond?.format ?? null);
  const [condMin, setCondMin] = useState<number>(initial?.cond && (initial.cond.format === "amrap" || initial.cond.format === "for_time") ? Math.round(initial.cond.capSec / 60) : 12);
  const [condInterval, setCondInterval] = useState<number>(initial?.cond?.intervalSec ?? (initial?.cond?.format === "tabata" ? 20 : 60));
  const [condRest, setCondRest] = useState<number>(initial?.cond?.restSec ?? 10);
  const [condRounds, setCondRounds] = useState<number>(initial?.cond?.rounds ?? (initial?.cond?.format === "tabata" ? 8 : 10));
  const condBlock: CondBlock | null = condFormat ? {
    format: condFormat,
    capSec: condCap(condFormat, { minutes: condMin, intervalSec: condFormat === "tabata" ? condInterval : condFormat === "emom" ? condInterval : undefined, restSec: condRest, rounds: condRounds }),
    ...(condFormat === "emom" || condFormat === "tabata" ? { intervalSec: condInterval, rounds: condRounds } : {}),
    ...(condFormat === "tabata" ? { restSec: condRest } : {}),
  } : null;
  const pickFormat = (f: CondFormat | null) => {
    setCondFormat(f);
    if (f === "tabata") { setCondInterval(20); setCondRest(10); setCondRounds(8); }
    if (f === "emom") { setCondInterval(60); setCondRounds(10); }
    if (f === "for_time") { setKind("time_faster"); setUnit("sec"); }
    else if (f) { setKind("rounds"); setUnit(undefined); }
  };

  const suggestions = library && nameFocused && name.trim().length > 0
    ? searchLibrary(library, name, 5).filter((s) => s.name.toLowerCase() !== name.trim().toLowerCase())
    : [];

  // ONE EDITOR (D1): the bulk steppers write straight into the strip, so a
  // new exercise opens with them out -- creation stays one glance -- while
  // an edit opens on the chips themselves.
  const [bulkOpen, setBulkOpen] = useState(mode === "new");
  // REORDER IS A MODE (Health Preview): the strip's grips come out from the
  // group's own Reorder pill and go away on Done.
  const [reorderSets, setReorderSets] = useState(false);

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
  // A clock has no strip to plan: its plan is the format.
  const valid = name.trim().length > 0 && (sets.length > 0 || condBlock != null);

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
  const rampPreview = ramp ? rampFor(draft, rackFrom(readGymSettings())) : [];

  const save = () => {
    if (!valid) { setTouched(true); return; }
    onSave({
      name: name.trim(), kind, sets: condBlock ? [] : sets,
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
      ...(muscleGroup ? { muscleGroup } : {}),
      ...(condBlock ? { cond: condBlock } : {}),
    });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card train-skin xs" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar title={mode === "new" ? "New Exercise" : "Edit Exercise"} onCancel={onCancel} onSave={save} saveDisabled={!valid} />
        <div className="sheet-form">
          {/* THE NAME is the first group, no label: the field is the row. */}
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <input
                className={"xs-input" + (touched && !name.trim() ? " input-error" : "")}
                placeholder="Exercise Name"
                aria-label="Exercise name"
                value={name}
                // Typing (including renaming an existing exercise) never
                // touches exerciseKey -- a rename must keep the SAME history,
                // which is the entire bug the library exists to fix (catalog
                // §1.3). The key only ever changes by picking a suggestion.
                onChange={(e) => setName(e.target.value)}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setTimeout(() => setNameFocused(false), 150)}
              />
            </div>
            {/* THE EXERCISE LIBRARY (catalog §3.5): offered the moment there is
                anything to match against. Picking one carries the EXACT name
                forward, which is what stops "Trap Bar Deadlift" and "Trap bar
                DL" from ever becoming two histories in the first place. */}
            {suggestions.map((s) => (
              <div className="row xs-row xs-suggest" role="button" tabIndex={0} key={s.key} onMouseDown={() => pickSuggestion(s)}>
                <div className="row-grow">
                  <div className="conn-name truncate">{s.name}</div>
                  <div className="conn-meta">{MEASURE_LABEL[s.kind]}</div>
                </div>
              </div>
            ))}
          </div></div>
          {touched && !name.trim() && <div className="input-error xs-error">Add a name.</div>}

          {/* SETS. The summary row speaks the whole plan; Edit All Sets writes
              count and targets across every chip at once, straight into the
              strip below -- one object, one editor (D1). */}
          {!condBlock && (
            <>
              <div className="grp xs-grp">
                <div className="eyebrow">{countLabel(kind)}</div>
                {sets.length > 1 && (
                  <button className="pill-act pill-neutral" onClick={() => setReorderSets((r) => !r)}>{reorderSets ? "Done" : "Reorder"}</button>
                )}
              </div>
              <div className="pad-x"><div className="card xs-group">
                <div className="row xs-row">
                  <div className="row-grow">
                    <div className="conn-name">{targetLine(draft)}</div>
                    <div className="conn-meta">{isUniformStrip(kind, sets) ? "Uniform" : "Varies by set"}</div>
                  </div>
                  {/* The sanctioned in-row pill, neutral, 44px hit box via its own ::after. */}
                  <button className="pill-act pill-neutral" aria-expanded={bulkOpen} onClick={() => setBulkOpen((o) => !o)}>
                    {bulkOpen ? "Done" : "Edit All Sets"}
                  </button>
                </div>
                {bulkOpen && (
                  <>
                    <div className="row xs-row">
                      <div className="row-grow"><div className="conn-name">{countLabel(kind)}</div></div>
                      <Stepper value={sets.length} step={1} min={1} label={countLabel(kind)} onChange={(n) => setSets((s) => resizeStrip(s, n))} />
                    </div>
                    {kind !== "done" && fields.map((f) => (
                      <div className="row xs-row" key={f.key}>
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
                      <div className="row xs-row">
                        <div className="conn-name">Unit</div>
                        <HeadMenu variant="value" ariaLabel="Unit" value={unit ?? units[0]!}
                          options={units.map((u) => ({ value: u, label: u }))} onPick={setUnit} />
                      </div>
                    )}
                    {kind === "distance_time" && (
                      <div className="row xs-row">
                        <div className="conn-name">Time Unit</div>
                        <HeadMenu variant="value" ariaLabel="Time unit" value={timeUnit}
                          options={TIME_UNITS.map((u) => ({ value: u, label: u }))} onPick={setTimeUnit} />
                      </div>
                    )}
                  </>
                )}
                <div className="row xs-strip">
                  <SetStrip kind={kind} unit={unit} timeUnit={timeUnit} entries={sets} onChange={setSets} handles={reorderSets}
                    lastFor={lastHit ? (i) => (lastHit.sets[i] ? `Last: ${formatSet(lastHit.fx, lastHit.sets[i]!)}` : null) : undefined} />
                </div>
              </div></div>
              {touched && sets.length === 0 && <div className="input-error xs-error">Add at least one set.</div>}
            </>
          )}

          {/* TRACKS: what a set records, whether a clock runs it, which
              muscle it feeds. Each a row whose value opens a menu. */}
          <div className="grp xs-grp"><div className="eyebrow">Tracks</div></div>
          <div className="pad-x"><div className="card xs-group">
            {!condBlock && (
              <div className="row xs-row">
                <Tile tone="blue"><Gauge className="ic" /></Tile>
                <div className="conn-name">Measure</div>
                <HeadMenu variant="value" ariaLabel="Measure" value={kind}
                  options={MEASURE_KINDS.map((k) => ({ value: k, label: MEASURE_LABEL[k] }))} onPick={(k) => pickKind(k as MeasureKind)} />
              </div>
            )}
            {/* THE CONDITIONING BLOCK (2026-09-02). A format turns the strip
                into a clock: the session offers Start the Clock instead of a
                set to log, and writes a receipt with round splits after. */}
            <div className="row xs-row">
              <Tile tone="orange"><Timer className="ic" /></Tile>
              <div className="row-grow">
                <div className="conn-name">Clock</div>
                {condBlock && <div className="conn-meta">{condSummary(condBlock)}</div>}
              </div>
              <HeadMenu variant="value" ariaLabel="Clock" value={condFormat ?? "off"} off={!condFormat}
                options={[{ value: "off", label: "Off" }, ...COND_FORMATS.map((f) => ({ value: f, label: COND_LABEL[f] }))]}
                onPick={(v) => pickFormat(v === "off" ? null : (v as CondFormat))} />
            </div>
            {(condFormat === "amrap" || condFormat === "for_time") && (
              <div className="row xs-row">
                <div className="row-grow"><div className="conn-name">{condFormat === "amrap" ? "Window" : "Time Cap"}</div><div className="conn-meta">{condMin} min</div></div>
                <Stepper value={condMin} step={1} min={1} label="Minutes" onChange={setCondMin} />
              </div>
            )}
            {(condFormat === "emom" || condFormat === "tabata") && (
              <>
                <div className="row xs-row">
                  <div className="row-grow"><div className="conn-name">{condFormat === "emom" ? "Interval" : "Work"}</div><div className="conn-meta">{mmss(condInterval)}</div></div>
                  <Stepper value={condInterval} step={condFormat === "tabata" ? 5 : 15} min={5} label="Interval" onChange={setCondInterval} />
                </div>
                {condFormat === "tabata" && (
                  <div className="row xs-row">
                    <div className="row-grow"><div className="conn-name">Rest</div><div className="conn-meta">{mmss(condRest)}</div></div>
                    <Stepper value={condRest} step={5} min={5} label="Rest" onChange={setCondRest} />
                  </div>
                )}
                <div className="row xs-row">
                  <div className="row-grow"><div className="conn-name">Rounds</div><div className="conn-meta">{condRounds}</div></div>
                  <Stepper value={condRounds} step={1} min={1} label="Rounds" onChange={setCondRounds} />
                </div>
              </>
            )}
            {/* PUBLISHED RANGES, D13-C: set by hand, same doctrine as
                gameCategoryId and the Training Door -- the app never guesses a
                lift's muscle from its free-text name. None means the weekly
                hard-set row simply never claims this lift. */}
            <div className="row xs-row">
              <Tile tone="pink"><PersonStanding className="ic" /></Tile>
              <div className="row-grow">
                <div className="conn-name">Muscle</div>
                <div className="conn-meta">Weekly hard sets on Health</div>
              </div>
              <HeadMenu variant="value" ariaLabel="Muscle" value={muscleGroup ?? "none"} off={!muscleGroup}
                options={[{ value: "none", label: "None" }, ...MUSCLE_GROUPS.map((m) => ({ value: m, label: MUSCLE_LABEL[m] }))]}
                onPick={(v) => setMuscleGroup(v === "none" ? undefined : (v as MuscleGroup))} />
            </div>
          </div></div>

          {/* IN THE SESSION: what the live screen does with this exercise. */}
          <div className="grp xs-grp"><div className="eyebrow">In the Session</div></div>
          <div className="pad-x"><div className="card xs-group">
            {/* REST TIMER (catalog §4.3), optional and per-exercise. 0 means no
                timer offered in-session -- most "done" and reps work has none. */}
            {kind !== "done" && (
              <div className="row xs-row">
                <Tile tone="teal"><Hourglass className="ic" /></Tile>
                <div className="row-grow">
                  <div className="conn-name">Rest Timer</div>
                  <div className="conn-meta">{restSec > 0 ? mmss(restSec) : "Off"}</div>
                </div>
                <Stepper value={restSec} step={15} min={0} label="Rest Timer" onChange={setRestSec} />
              </div>
            )}
            {/* THE RAMP (D3-A). Warm-up sets are DERIVED from the first working
                weight, never stored here: the plan stays the work, and editing
                the weight re-ramps for free. The preview below is the real
                derivation, so what it says is what the session offers. */}
            {kind === "weight_reps" && (
              <div className="row xs-row">
                <Tile tone="yellow"><Flame className="ic" /></Tile>
                <div className="row-grow">
                  <div className="conn-name">Warm-Up Ramp</div>
                  <div className="conn-meta">
                    {ramp
                      ? (rampPreview.length
                          ? rampPreview.map((r) => formatSet(draft, r)).join(" · ")
                          : "Nothing to ramp at this weight")
                      : "Built from your first working weight"}
                  </div>
                </div>
                <div className={"switch" + (ramp ? "" : " off")} role="switch" aria-checked={ramp} aria-label="Warm-up ramp" tabIndex={0}
                  onClick={() => setRamp((r) => !r)} />
              </div>
            )}
            {/* FILLER (catalog §4.2): offered during the rest of whatever it is
                paired with, instead of the athlete standing around. Pairing
                itself is set from the day list's long-press menu, once both
                exercises exist. */}
            <div className="row xs-row">
              <Tile tone="purple"><Shuffle className="ic" /></Tile>
              <div className="row-grow">
                <div className="conn-name">Filler</div>
                <div className="conn-meta">Offered during a pair's rest</div>
              </div>
              <div className={"switch" + (filler ? "" : " off")} role="switch" aria-checked={filler} aria-label="Filler" tabIndex={0}
                onClick={() => setFiller((f) => !f)} />
            </div>
          </div></div>

          <div className="grp xs-grp"><div className="eyebrow">Note</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <Tile tone="graphite"><StickyNote className="ic" /></Tile>
              {/* Reference, never coaching: the app does not tell anyone how to lift. */}
              <input className="xs-input" placeholder="Optional" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div></div>

          {mode === "edit" && onDelete && (
            // DELETE SITS ALONE AT THE VERY BOTTOM (ruled 2026-09-01). THE
            // PREVIEW IS THE SPEC: destructive text is bare red words, not
            // Cancel's grey pill with a warning sticker on it.
            <div className="pad-x xs-delete">
              {!armDelete
                ? <button className="btn btn-ghost-danger btn-block" onClick={() => setArmDelete(true)}><Trash2 className="ic" />Delete Exercise</button>
                : <button className="btn btn-danger btn-block" onClick={onDelete}>Tap Again to Confirm</button>}
            </div>
          )}
          {!(mode === "edit" && onDelete) && <div className="xs-foot" />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
