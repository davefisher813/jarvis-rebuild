import { useRef, useState } from "react";
import { own } from "../shared/rowDoor";
import { createPortal } from "react-dom";
import SheetBar from "../shared/SheetBar";
import { MUSCLE_GROUPS, MUSCLE_LABEL, type MuscleGroup } from "./muscles";
import { MEASURE_KINDS, MEASURE_LABEL, type MeasureKind } from "./types";
import { EQUIPMENT_KINDS, EQUIPMENT_LABEL, COUNTED_LABEL, countsFor, asksCount } from "./equipment";
import {
  EXECUTIONS, EXECUTION_LABEL, EXERCISE_TYPES, MOVEMENTS, MOVEMENT_LABEL, SCOPE_LABEL, TYPE_LABEL,
  scopeOf, withScope, valueLine, type Chip, type Classification, type MuscleScope,
} from "./classify";

// THE ONE CLASSIFICATION EDITOR (handoff §4: "Use the same classification
// editor in the exercise list and exercise details", §8: "Make classifications
// editable here and directly from the library using the same shared editor").
//
// One editor, three doors: a chip on a library row, Edit Details in the row's
// overflow, and the Classification card on the exercise's own page. `open`
// says which group to land on, so tapping the muscle chip opens the muscle
// question rather than the top of a long form -- the chip IS the door to its
// own field, which is the whole reason the row got chips.
//
// SHAPE OF THE FORM (§2): "Show Muscles, Equipment, and Measurement first. Put
// additional classifications under 'More details.'" Five taps of real work
// above the fold and everything else one disclosure below it, because nothing
// here is required and a long form that looks required is how a library ends
// up half-classified.

const OPEN_GROUP: Record<Chip["field"], string> = {
  muscles: "Muscles",
  equipment: "Equipment",
  measure: "Measurement",
  movement: "Movement Pattern",
  type: "Exercise Type",
  execution: "Execution",
  tag: "Tags",
};

/** The free-text rows under Execution and Equipment Identity. */
function TextRow({ label, value, placeholder, onChange }: {
  label: string; value: string; placeholder: string; onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    // The label and the gaps land in the field too (Dave 2026-09-15: "I want all rows clickable").
    <div className="row xs-row" onClick={() => ref.current?.focus()}>
      <div className="xs-label">{label}</div>
      <input
        ref={ref}
        className="xs-input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function ChipRow<T extends string>({ items, label: labelOf, value, onPick, ariaPrefix }: {
  items: readonly T[];
  label: (t: T) => string;
  value: T | undefined;
  onPick: (t: T | undefined) => void;
  ariaPrefix: string;
}) {
  return (
    // row-tap: chip strip, every inch of it is one of the answer chips
    <div className="row xs-row">
      <div className="chip-row chip-wrap-row">
        {items.map((t) => (
          <button
            key={t}
            type="button"
            className={"chip" + (value === t ? " active" : "")}
            aria-pressed={value === t}
            aria-label={`${ariaPrefix} ${labelOf(t)}`}
            // Tapping the picked one clears it: nothing on this sheet is
            // required, so every answer has to be un-answerable.
            onClick={() => onPick(value === t ? undefined : t)}
          >
            {labelOf(t)}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ClassifySheet({
  name, initial, open = "muscles", todayIso, askScope, onSave, onCancel,
}: {
  name: string;
  initial: Classification;
  /** Which group the sheet lands on. */
  open?: Chip["field"];
  todayIso: string;
  /** THE SCOPE QUESTION (§4). Asked when the muscles are being CORRECTED --
   *  a lift that already carries some -- and not when they are being set for
   *  the first time, where "existing and future" is the only sane reading of
   *  a first answer and a radio group would be three ways to say yes. */
  askScope?: boolean;
  onSave: (next: Classification, scope: MuscleScope) => void;
  onCancel: () => void;
}) {
  const [c, setC] = useState<Classification>(initial);
  const [more, setMore] = useState(open !== "muscles" && open !== "equipment" && open !== "measure");
  const [scope, setScope] = useState<MuscleScope>(scopeOf(initial));

  const set = (patch: Partial<Classification>) => setC((prev) => ({ ...prev, ...patch }));
  const clear = (k: keyof Classification) => setC((prev) => { const n = { ...prev }; delete n[k]; return n; });

  /** A muscle's role, cycled by tapping it: unset, primary, secondary, unset.
   *  One control for two lists. The alternative -- two chip rows with the
   *  same ten words in both -- was drawn and rejected: it doubles the
   *  reading and lets a muscle be in both at once. */
  const roleOf = (m: MuscleGroup): "primary" | "secondary" | null =>
    c.primary.includes(m) ? "primary" : c.secondary.includes(m) ? "secondary" : null;
  const cycle = (m: MuscleGroup) => {
    const role = roleOf(m);
    if (role === null) set({ primary: [...c.primary, m], secondary: c.secondary.filter((x) => x !== m) });
    else if (role === "primary") set({ primary: c.primary.filter((x) => x !== m), secondary: [...c.secondary, m] });
    else set({ primary: c.primary.filter((x) => x !== m), secondary: c.secondary.filter((x) => x !== m) });
  };

  const counts = countsFor(c.equipment);
  const toggleArchived = () => (c.archived ? clear("archived") : set({ archived: true }));

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar
          title={name}
          onCancel={onCancel}
          saveLabel="Save"
          onSave={() => onSave(withScope(c, scope, todayIso), scope)}
        />
        <div className="sheet-form">
          {/* MUSCLES. The one axis anything downstream depends on, so it
              leads, and its row says what the two roles do to the count
              rather than leaving the athlete to infer it from a colour. */}
          <div className="grp xs-grp"><div className="eyebrow">{OPEN_GROUP.muscles}</div></div>
          <div className="pad-x"><div className="card xs-group">
            <div className="row xs-row">
              <div className="row-grow">
                <div className="conn-name">Muscles Worked</div>
                <div className="conn-meta">Tap once for primary, twice for secondary</div>
              </div>
            </div>
            {/* row-tap: chip strip, every inch of it is one of the muscle chips */}
            <div className="row xs-row">
              <div className="chip-row chip-wrap-row">
                {MUSCLE_GROUPS.map((m) => {
                  const role = roleOf(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      // Three states, strongest first: primary is the filled
                      // .active chip, secondary the .chip-half tint below it,
                      // unset the plain chip. It used to spend .chip-on --
                      // which means SELECTED everywhere else in the app -- on
                      // SECONDARY, so the loudest chip on the card was the
                      // weaker role and the colour argued with the line under
                      // it. See the note at .chip-half in components.css.
                      className={"chip" + (role === "primary" ? " active" : role === "secondary" ? " chip-half" : "")}
                      aria-pressed={role !== null}
                      aria-label={`${MUSCLE_LABEL[m]}${role ? ", " + role : ""}`}
                      onClick={() => cycle(m)}
                    >
                      {MUSCLE_LABEL[m]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="row xs-row">
              <div className="row-grow">
                <div className="facts">
                  <span className="fact">{c.primary.length ? `Primary ${c.primary.map((m) => MUSCLE_LABEL[m]).join(", ")}` : "No primary yet"}</span>
                  {c.secondary.length > 0 && <span className="fact cyan">{`Secondary ${c.secondary.map((m) => MUSCLE_LABEL[m]).join(", ")}`}</span>}
                </div>
                {/* The counting convention is methodology, which rule 3 of the
                  2026-09-16 polish puts behind a labelled disclosure: you need
                  it once, and then it is a grey sentence in the middle of a
                  form you come back to. The line above it -- which muscles are
                  actually set -- is the fact, and stays. */}
              <details className="exp-more">
                <summary>How Sets Are Counted</summary>
                <div className="conn-meta">A primary counts a whole working set, a secondary counts half</div>
              </details>
              </div>
            </div>
          </div></div>

          {/* THE SCOPE (§4). Three words, one row, only when it is a real
              question, and the answer stays visible on the exercise
              afterwards rather than being a thing that happened once. */}
          {askScope && (
            <>
              <div className="grp xs-grp"><div className="eyebrow">Applies To</div></div>
              <div className="pad-x"><div className="card xs-group">
                {/* row-tap: chip strip, every inch of it is one of the three scope chips */}
                <div className="row xs-row">
                  <div className="chip-row chip-wrap-row">
                    {(["all", "existing", "future"] as MuscleScope[]).map((s) => (
                      <button key={s} type="button" className={"chip" + (scope === s ? " active" : "")}
                        aria-pressed={scope === s} onClick={() => setScope(s)}>
                        {SCOPE_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="row xs-row"><div className="row-grow"><div className="conn-meta">
                  {scope === "all"
                    ? "Every session this exercise has, and every one to come"
                    : scope === "future"
                      ? `Sessions from ${todayIso} on · Earlier ones keep what they had`
                      : `Sessions up to ${todayIso} · Later ones will not carry these`}
                </div></div></div>
              </div></div>
            </>
          )}

          {/* EQUIPMENT, and what its number means. The second row only
              appears when the equipment leaves the reading genuinely open,
              which is the rule equipment.ts has kept since it shipped. */}
          <div className="grp xs-grp"><div className="eyebrow">{OPEN_GROUP.equipment}</div></div>
          <div className="pad-x"><div className="card xs-group">
            <ChipRow items={EQUIPMENT_KINDS} label={(e) => EQUIPMENT_LABEL[e]} value={c.equipment} ariaPrefix="Equipment"
              onPick={(e) => (e ? set({ equipment: e, ...(c.counted && !countsFor(e).includes(c.counted) ? { counted: undefined } : {}) }) : (clear("equipment"), clear("counted")))} />
            {asksCount(c.equipment) && (
              <>
                <div className="row xs-row"><div className="row-grow"><div className="conn-meta">What the number means</div></div></div>
                <ChipRow items={counts} label={(x) => COUNTED_LABEL[x]} value={c.counted} ariaPrefix="Counted as"
                  onPick={(x) => (x ? set({ counted: x }) : clear("counted"))} />
              </>
            )}
          </div></div>

          {/* MEASUREMENT. Editable, and honest about what editing it does:
              it is what the NEXT sighting carries, never a rewrite of what
              recorded numbers already mean. */}
          <div className="grp xs-grp"><div className="eyebrow">{OPEN_GROUP.measure}</div></div>
          <div className="pad-x"><div className="card xs-group">
            <ChipRow items={MEASURE_KINDS} label={(k: MeasureKind) => MEASURE_LABEL[k]} value={c.measure} ariaPrefix="Measured as"
              onPick={(k) => (k ? set({ measure: k }) : clear("measure"))} />
            <div className="row xs-row"><div className="row-grow"><div className="conn-meta">
              Sessions already logged keep the numbers and units they were recorded with
            </div></div></div>
          </div></div>

          <div className="pad-x">
            <button type="button" className="btn btn-secondary btn-block" aria-expanded={more} onClick={() => setMore((v) => !v)}>
              {more ? "Fewer Details" : "More Details"}
            </button>
          </div>

          {more && (
            <>
              <div className="grp xs-grp"><div className="eyebrow">{OPEN_GROUP.movement}</div></div>
              <div className="pad-x"><div className="card xs-group">
                <ChipRow items={MOVEMENTS} label={(m) => MOVEMENT_LABEL[m]} value={c.movement} ariaPrefix="Movement"
                  onPick={(m) => (m ? set({ movement: m }) : clear("movement"))} />
              </div></div>

              <div className="grp xs-grp"><div className="eyebrow">{OPEN_GROUP.type}</div></div>
              <div className="pad-x"><div className="card xs-group">
                <ChipRow items={EXERCISE_TYPES} label={(t) => TYPE_LABEL[t]} value={c.type} ariaPrefix="Type"
                  onPick={(t) => (t ? set({ type: t }) : clear("type"))} />
              </div></div>

              <div className="grp xs-grp"><div className="eyebrow">{OPEN_GROUP.execution}</div></div>
              <div className="pad-x"><div className="card xs-group">
                <ChipRow items={EXECUTIONS} label={(x) => EXECUTION_LABEL[x]} value={c.execution} ariaPrefix="Execution"
                  onPick={(x) => (x ? set({ execution: x }) : clear("execution"))} />
                <TextRow label="Grip" value={c.grip ?? ""} placeholder="Neutral · Wide · Hook" onChange={(v) => set({ grip: v })} />
                <TextRow label="Stance" value={c.stance ?? ""} placeholder="Sumo · Staggered" onChange={(v) => set({ stance: v })} />
                <TextRow label="Angle" value={c.angle ?? ""} placeholder="Low pulley · Thirty degrees" onChange={(v) => set({ angle: v })} />
                <TextRow label="Variation" value={c.variation ?? ""} placeholder="Paused · Tempo · Deficit" onChange={(v) => set({ variation: v })} />
              </div></div>

              {/* EQUIPMENT IDENTITY. This is what makes two same-named
                  exercises legitimately different, which is exactly what §6
                  asks the duplicate review to show before it proposes
                  anything. */}
              <div className="grp xs-grp"><div className="eyebrow">Equipment Identity</div></div>
              <div className="pad-x"><div className="card xs-group">
                <TextRow label="Gym" value={c.gym ?? ""} placeholder="Home · Planet Fitness" onChange={(v) => set({ gym: v })} />
                <TextRow label="Machine" value={c.machineName ?? ""} placeholder="Hammer Strength Row" onChange={(v) => set({ machineName: v })} />
                <TextRow label="Machine ID" value={c.machineId ?? ""} placeholder="Frame number · Station 4" onChange={(v) => set({ machineId: v })} />
              </div></div>

              <div className="grp xs-grp"><div className="eyebrow">{OPEN_GROUP.tag}</div></div>
              <div className="pad-x"><div className="card xs-group">
                <TextRow
                  label="Tags"
                  value={c.tags.join(", ")}
                  placeholder="Warm-up · Rehab · Comp lift"
                  onChange={(v) => set({ tags: v.split(",").map((t) => t.trim()).filter(Boolean) })}
                />
              </div></div>

              <div className="grp xs-grp"><div className="eyebrow">Archive</div></div>
              <div className="pad-x"><div className="card xs-group">
                {/* The row flips the draft the same way its pill does; nothing is
                    written until Save (Dave 2026-09-15: "I want all rows clickable"). */}
                <div className="row xs-row" onClick={toggleArchived}>
                  <div className="row-grow">
                    <div className="conn-name">{c.archived ? "Archived" : "Active"}</div>
                    <div className="conn-meta">An archived exercise keeps every record it has</div>
                  </div>
                  <button type="button" className="pill-act" onClick={own(toggleArchived)}>
                    {c.archived ? "Restore" : "Archive"}
                  </button>
                </div>
              </div></div>
            </>
          )}

          {/* WHAT IT SAYS NOW, at the foot, so Save is not a leap of faith.
              It is the app's own quiet foot line since 2026-09-16 (Dave,
              photographed: "these modals need to be remodeled and cleaned up
              completely"). As a bare .bp-sub it sat under the last card with
              no label and no ground, so "Hamstrings · Also Glutes" read as a
              stray sentence somebody forgot to delete rather than as the
              receipt for what Save is about to write. .list-floor is what this
              app uses for a line that reports rather than asks. */}
          <div className="list-floor">
            {valueLine(c, "muscles") ?? "No muscles yet"}
          </div>
          <div className="xs-foot" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
