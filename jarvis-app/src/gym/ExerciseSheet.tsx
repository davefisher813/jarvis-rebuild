import { createPortal } from "react-dom";
import { Fragment, useRef, useState, type ReactNode } from "react";
import { own } from "../shared/rowDoor";
import { MEASURE_KINDS, MEASURE_LABEL, unitsFor, defaultUnit, TIME_UNITS, COND_FORMATS, COND_LABEL, type CondBlock, type CondFormat, type Exercise, type MeasureKind, type SetEntry, type Workout } from "./types";
import { EQUIPMENT_KINDS, EQUIPMENT_LABEL, EQUIPMENT_NOTE, COUNTED_LABEL, asksCount, countsFor, defaultCount, loadStyleOf, weightless, type Counted, type Equipment, type LoadStyle } from "./equipment";
import { condCap, condSummary, mmss } from "./conditioning";
import { fieldsFor, formatSet, isUniformStrip } from "./measures";
import { uniformStrip, resizeStrip, applyToAll } from "./strip";
import { rampFor } from "./ramp";
import { lastSessionFor } from "./prs";
import { readGymSettings, rackFrom } from "./settings";
import SetStrip from "./SetStrip";
import Stepper from "../shared/Stepper";
import SheetBar from "../shared/SheetBar";
import HeadMenu from "../shared/HeadMenu";
import { Trash2, Dumbbell, Gauge, Timer, PersonStanding, Hourglass, Flame, Shuffle, StickyNote, Link2 } from "../shared/icons";
import { searchLibrary, newExerciseKey, type LibraryEntry } from "./library";
import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "./muscles";

// The count row in the user's language, never "How many" (Dave, 2026-08-15).
const countLabel = (kind: MeasureKind): string => {
  if (kind === "done") return "Times";
  if (kind === "time_faster" || kind === "distance_time") return "Attempts";
  return "Sets";
};

// REST IS A MENU (2026-09-14, the reference editor's "Rest between sets"
// and Stepper's own rule: chips or a menu for a value with a preset set).
// A stepper from 0 in fifteens was the wrong control for 2:00. A rest the
// presets do not name (an older 0:45) stays offered as itself.
const REST_PRESETS = [0, 60, 90, 120, 180, 300];
function restOptions(current: number): { value: string; label: string }[] {
  const all = REST_PRESETS.includes(current) ? REST_PRESETS : [...REST_PRESETS, current].sort((a, b) => a - b);
  return all.map((s) => ({ value: String(s), label: s === 0 ? "Off" : mmss(s) }));
}

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
export default function ExerciseSheet({ mode, initial, library, history, onSave, onDelete, onCancel, partner, onPairWith }: {
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
  /** Health Push E (H-24): who this exercise is grouped with today, as a
   *  name or names, and the door to the day's own Group With picker. Both
   *  absent on a new exercise and on a day with nothing else to pair. */
  partner?: string | null;
  onPairWith?: () => void;
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
  // EQUIPMENT AND READING (2026-09-14), two rows where there was one. The
  // initial value runs through loadStyleOf, so an exercise saved under the
  // old single menu -- including the two options that were never equipment --
  // opens with the right answer already in both rows.
  const [equipment, setEquipment] = useState<Equipment | "">(initial ? (loadStyleOf(initial).equipment ?? "") : "");
  const [counted, setCounted] = useState<Counted | undefined>(initial ? loadStyleOf(initial).counted : undefined);
  const loadStyle: LoadStyle = {
    ...(equipment ? { equipment } : {}),
    ...(counted ? { counted } : {}),
  };
  // Picking the equipment moves the reading to that equipment's own default,
  // so choosing Dumbbells says "Each Hand" without a second tap and choosing
  // Assisted flips the whole lift's direction of progress on its own. The
  // athlete can still override it on the row below, where one exists.
  const pickEquipment = (e: Equipment | "") => {
    setEquipment(e);
    setCounted(e ? defaultCount(e) : undefined);
  };
  // Part 3 wave 2: the rest after a full round of the group this belongs to.
  const [roundRestSec, setRoundRestSec] = useState(initial?.roundRestSec ?? 0);
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
    ? searchLibrary(library, name, 5, readGymSettings().hiddenKeys ?? []).filter((s) => s.name.toLowerCase() !== name.trim().toLowerCase())
    : [];

  // ONE EDITOR (D1): the count and target rows write straight into the
  // strip. The strip itself is out only when it has something to show that
  // the rows cannot: an edit of a plan that already varies by set.
  const [stripOpen, setStripOpen] = useState(mode === "edit" && !isUniformStrip(kind, sets));
  // REORDER IS A MODE (Health Preview): the strip's grips come out from the
  // group's own Reorder pill and go away on Done.
  const [reorderSets, setReorderSets] = useState(false);
  // Form rows land their tap on their own field (Dave 2026-09-15: "I want all rows clickable").
  const nameRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const toggleStrip = () => { setStripOpen((o) => !o); setReorderSets(false); };

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
  // The Weight field now takes its NAME and its INCREMENT from the equipment
  // (2026-09-14), so the row reads "Weight Per Hand" on dumbbells and
  // "Assistance" on an assist machine, and steps 10 on a stack and 2.5 on a
  // dip belt instead of 5 on everything.
  const fields = fieldsFor(kind, { ...loadStyle, unit });
  const noWeight = kind === "weight_reps" && weightless(loadStyle);
  const shownFields = noWeight ? fields.filter((f) => f.key !== "w") : fields;
  // A clock has no strip to plan: its plan is the format.
  const valid = name.trim().length > 0 && (sets.length > 0 || condBlock != null);

  // LAST TIME, D2: the same per-position reference the live session shows,
  // here as quiet planning context ("Last: 250 × 3" under each chip). Reads
  // the name as typed, so picking a library suggestion lights it up.
  // GYM-F-04 (2026-09-05): keyed, so renaming an exercise in the editor keeps
  // showing the same lift's real last session instead of going blank.
  const lastHit = history && readGymSettings().showLast && name.trim()
    ? lastSessionFor(history, { name: name.trim(), exerciseKey }, kind)
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
      ...(kind === "weight_reps" && equipment ? { equipment } : {}),
      // The reading rides with the equipment, and is saved even when it is
      // that equipment's default: a set logged today has to keep meaning
      // what it meant if the defaults are ever revised.
      ...(kind === "weight_reps" && counted ? { counted } : {}),
      ...(partner && roundRestSec > 0 ? { roundRestSec } : {}),
      ...(condBlock ? { cond: condBlock } : {}),
    });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card xs" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar title={mode === "new" ? "New Exercise" : "Edit Exercise"} onCancel={onCancel} onSave={save} saveDisabled={!valid} />
        <div className="sheet-form">
          {/* THE NAME is the first group, and it wears the same anatomy as
              the others (Dave 2026-09-02: "I don't like the way the container
              at the top of the exercise modal renders. Make it render like
              the rest design wise"): a caps label, a tile with the lift's own
              glyph in the gym's orange, the field as the row. */}
          <div className="grp xs-grp"><div className="eyebrow">Name</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row" onClick={() => nameRef.current?.focus()}>
              <Tile tone="orange"><Dumbbell className="ic" /></Tile>
              <input
                ref={nameRef}
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
              // GYM-F-26 (2026-09-05): onMouseDown fires before the name
              // field's blur eats the row, which is why it is mouse-down and
              // not click. But it announced itself as a button with no key
              // path at all, so a keyboard or VoiceOver user could not pick a
              // suggestion. Enter and Space now do what the tap does.
              <div className="row xs-row xs-suggest" role="button" tabIndex={0} key={s.key}
                onMouseDown={() => pickSuggestion(s)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickSuggestion(s); } }}>
                <div className="row-grow">
                  <div className="conn-name truncate">{s.name}</div>
                  <div className="conn-meta">{MEASURE_LABEL[s.kind]}</div>
                </div>
              </div>
            ))}
          </div></div>
          {touched && !name.trim() && <div className="input-error xs-error">Add a name.</div>}

          {/* SETS (2026-09-14, to the reference editor): the count, the
              target and the unit are the rows, always out, and the per-set
              strip sits behind one Customize Individual Sets row. The old
              summary-plus-Edit-All-Sets toggle hid the three fields most
              edits are for behind a pill. The strip is still the one editor
              (D1): these rows write into it through resizeStrip and
              applyToAll, and the row says Uniform or Varies by Set. */}
          {!condBlock && (
            <>
              <div className="grp xs-grp">
                <div className="eyebrow">{countLabel(kind)}</div>
                {stripOpen && sets.length > 1 && (
                  <button className="pill-act pill-neutral" onClick={() => setReorderSets((r) => !r)}>{reorderSets ? "Done" : "Reorder"}</button>
                )}
              </div>
              <div className="pad-x"><div className="card xs-group">
                <div className="row xs-row">
                  <div className="row-grow"><div className="conn-name">{countLabel(kind)}</div></div>
                  <Stepper value={sets.length} step={1} min={1} label={countLabel(kind)} onChange={(n) => setSets((s) => resizeStrip(s, n))} />
                </div>
                {kind !== "done" && shownFields.map((f) => (
                  <Fragment key={f.key}>
                    {/* EQUIPMENT COMES BEFORE WEIGHT (2026-09-14). It used to
                        sit two groups further down, under Tracks, which put
                        the thing that DEFINES what the weight means below the
                        weight itself: you typed 100 and only later said
                        whether that was a barbell's total, one dumbbell, or
                        one side of a machine. Reading down the group now goes
                        Sets, Reps, Equipment, Weight Per Hand, lb -- each row
                        making sense of the next. */}
                    {f.key === "w" && (
                      <>
                        <div className="row xs-row">
                          <div className="row-grow">
                            <div className="conn-name">Equipment</div>
                            {equipment && EQUIPMENT_NOTE(equipment) && <div className="conn-meta">{EQUIPMENT_NOTE(equipment)}</div>}
                          </div>
                          <HeadMenu variant="value" ariaLabel="Equipment" value={equipment} off={!equipment}
                            options={[{ value: "", label: "Not Set" }, ...EQUIPMENT_KINDS.map((k) => ({ value: k, label: EQUIPMENT_LABEL[k] }))]}
                            onPick={(v) => pickEquipment(EQUIPMENT_KINDS.includes(v as Equipment) ? (v as Equipment) : "")} />
                        </div>
                        {/* ONLY WHEN IT IS ACTUALLY A QUESTION. A weight stack
                            has exactly one reading, so it costs no row and no
                            tap; dumbbells and plate machines have two. */}
                        {asksCount(equipment || undefined) && (
                          <div className="row xs-row">
                            <div className="conn-name">Counted As</div>
                            <HeadMenu variant="value" ariaLabel="Counted as" value={counted ?? "total"}
                              options={countsFor(equipment || undefined).map((c) => ({ value: c, label: COUNTED_LABEL[c] }))}
                              onPick={(v) => setCounted(v as Counted)} />
                          </div>
                        )}
                      </>
                    )}
                    <div className="row xs-row">
                      <div className="row-grow">
                        <div className="conn-name">{f.label}</div>
                        {(f.key === "w" || f.key === "v") && unit && <div className="conn-meta">{unit}</div>}
                        {f.key === "t" && <div className="conn-meta">{timeUnit}</div>}
                      </div>
                      <Stepper value={sets.find((s) => !s.skipped)?.[f.key] ?? 0} step={f.step} label={f.label}
                        onChange={(n) => setSets((s) => applyToAll(kind, s, f.key, n))} />
                    </div>
                  </Fragment>
                ))}
                {/* A BAND HAS NO NUMBER. Its Weight row is gone rather than
                    sitting there at 0 asking to be filled in with a fiction;
                    the equipment chooser still has to be reachable, so it
                    stands on its own here. */}
                {noWeight && (
                  <div className="row xs-row">
                    <div className="row-grow">
                      <div className="conn-name">Equipment</div>
                      <div className="conn-meta">{EQUIPMENT_NOTE("band")}</div>
                    </div>
                    <HeadMenu variant="value" ariaLabel="Equipment" value={equipment}
                      options={[{ value: "", label: "Not Set" }, ...EQUIPMENT_KINDS.map((k) => ({ value: k, label: EQUIPMENT_LABEL[k] }))]}
                      onPick={(v) => pickEquipment(EQUIPMENT_KINDS.includes(v as Equipment) ? (v as Equipment) : "")} />
                  </div>
                )}
                {units.length > 1 && !noWeight && (
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
                <div className="row xs-row" onClick={toggleStrip}>
                  <div className="row-grow">
                    <div className="conn-name">Customize Individual Sets</div>
                    <div className="conn-meta">{isUniformStrip(kind, sets) ? "Uniform" : "Varies by set"}</div>
                  </div>
                  <button className="pill-act pill-neutral" aria-expanded={stripOpen} onClick={own(toggleStrip)}>
                    {stripOpen ? "Hide" : "Show"}
                  </button>
                </div>
                {stripOpen && (
                  <div className="row xs-strip">
                    <SetStrip kind={kind} unit={unit} timeUnit={timeUnit} style={loadStyle} entries={sets} onChange={setSets} handles={reorderSets}
                      lastFor={lastHit ? (i) => (lastHit.sets[i] ? `Last: ${formatSet(lastHit.fx, lastHit.sets[i]!)}` : null) : undefined} />
                  </div>
                )}
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
              <Tile tone="green"><Timer className="ic" /></Tile>
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
              </div>
              <HeadMenu variant="value" ariaLabel="Muscle" value={muscleGroup ?? "none"} off={!muscleGroup}
                options={[{ value: "none", label: "None" }, ...MUSCLE_GROUPS.map((m) => ({ value: m, label: MUSCLE_LABEL[m] }))]}
                onPick={(v) => setMuscleGroup(v === "none" ? undefined : (v as MuscleGroup))} />
            </div>
            {/* EQUIPMENT MOVED OUT OF TRACKS (2026-09-14) and up beside the
                Weight row it defines. Tracks is for what a set RECORDS;
                equipment is what the recorded number MEANS, which belongs
                next to the number. */}
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
                </div>
                <HeadMenu variant="value" ariaLabel="Rest Timer" value={String(restSec)} off={restSec === 0}
                  options={restOptions(restSec)} onPick={(v) => setRestSec(Number(v))} />
              </div>
            )}
            {/* THE RAMP (D3-A). Warm-up sets are DERIVED from the first working
                weight, never stored here: the plan stays the work, and editing
                the weight re-ramps for free. The preview below is the real
                derivation, so what it says is what the session offers. */}
            {kind === "weight_reps" && (
              <div className="row xs-row" onClick={() => setRamp((r) => !r)}>
                <Tile tone="yellow"><Flame className="ic" /></Tile>
                <div className="row-grow">
                  <div className="conn-name">Warm-Up Ramp</div>
                  {/* The preview is data, so it shows; Off needs no sentence. */}
                  {ramp && (
                    <div className="conn-meta">
                      {rampPreview.length ? rampPreview.map((r) => formatSet(draft, r)).join(" · ") : "Nothing to ramp at this weight"}
                    </div>
                  )}
                </div>
                <div className={"switch" + (ramp ? "" : " off")} role="switch" aria-checked={ramp} aria-label="Warm-up ramp" tabIndex={0}
                  onClick={own(() => setRamp((r) => !r))} />
              </div>
            )}
            {/* PAIR WITH (Health Push E, H-24): who this one alternates with,
                and the door to the day's own Group With picker, so pairing no
                longer hides behind a long press on the day list. */}
            {onPairWith && (
              <div className="row xs-row" onClick={onPairWith}>
                <Tile tone="teal"><Link2 className="ic" /></Tile>
                <div className="row-grow">
                  <div className="conn-name">Pair With</div>
                  <div className="conn-meta">{partner ?? "Not paired"}</div>
                </div>
                <button className="pill-act pill-neutral" onClick={own(onPairWith)}>{partner ? "Change" : "Choose"}</button>
              </div>
            )}
            {/* REST AFTER THE ROUND (Part 3 wave 2): only once the exercise
                is in a group. Off means the session rests after every set. */}
            {onPairWith && partner && (
              <div className="row xs-row">
                <Tile tone="teal"><Hourglass className="ic" /></Tile>
                <div className="row-grow">
                  <div className="conn-name">Rest After the Round</div>
                  <div className="conn-meta">{roundRestSec > 0 ? "Once every member has gone" : "Rest after every set"}</div>
                </div>
                <HeadMenu variant="value" ariaLabel="Rest After the Round" value={String(roundRestSec)} off={roundRestSec === 0}
                  options={restOptions(roundRestSec)} onPick={(v) => setRoundRestSec(Number(v))} />
              </div>
            )}
            {/* FILLER (catalog §4.2): offered during the rest of whatever it is
                paired with, instead of the athlete standing around. Pairing
                itself is set from the day list's long-press menu, once both
                exercises exist. */}
            <div className="row xs-row" onClick={() => setFiller((f) => !f)}>
              <Tile tone="purple"><Shuffle className="ic" /></Tile>
              <div className="row-grow">
                <div className="conn-name">Filler</div>
                <div className="conn-meta">Offered during a pair's rest</div>
              </div>
              <div className={"switch" + (filler ? "" : " off")} role="switch" aria-checked={filler} aria-label="Filler" tabIndex={0}
                onClick={own(() => setFiller((f) => !f))} />
            </div>
          </div></div>

          <div className="grp xs-grp"><div className="eyebrow">Note</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row" onClick={() => noteRef.current?.focus()}>
              <Tile tone="graphite"><StickyNote className="ic" /></Tile>
              {/* Reference, never coaching: the app does not tell anyone how to lift. */}
              <input ref={noteRef} className="xs-input" placeholder="Optional" aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
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
