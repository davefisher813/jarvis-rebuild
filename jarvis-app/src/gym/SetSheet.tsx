import { useState } from "react";
import { FormSheet, Group, FieldRow, Row, SwitchRow, DeleteRow } from "../shared/FormSheet";
import { Flame } from "../shared/icons";
import type { MeasureKind, SetEntry } from "./types";
import type { fieldsFor } from "./measures";

// THE SET SHEET (2026-09-26, the workout logging pass-off; Dave: "Logging
// renders inconsistently. Different styles show up for logging depending on
// what's clicked. Needs one single clean logging flow, no fluctuation").
//
// A logged set used to open an INLINE panel under its chip: steppers in
// reps-then-weight order, the How Did It Move chips, then two red rows. The
// set being logged, one row down, was two bare fields in weight-then-reps
// order. Two input styles for the same two numbers, on one screen.
//
// In the live session a Done row opens this sheet instead: the same two
// fields the Now row has, in the same order, then How Did It Move, then the
// set's own moves. The program editor and the finished-workout editor keep
// their inline steppers (SetStrip's SetChipEditor); this is the session's
// door only, which is why it is its own file and not a mode of that one.
//
// A field left empty comes OFF the set (empty is legal, measures.ts): a
// weight nobody said is not a zero.
//
// WARM-UP SET, THE ONE PLACE A LOGGED SET CHANGES KIND (2026-09-29, Dave: "I
// should also be EASILY able to mark sets as warm ups and vice versa"). A
// switch at the top of the sheet; Save writes `warmup` with the numbers, and
// nothing else about the set moves. Whether a row says "Warm-Up" or "Set 3",
// and what number the work sets carry, is derived from the flag everywhere
// (stateWord.ts, workNoAt), so flipping it renumbers the work for free. A
// warm-up carries no How Did It Move mark, so converting to one lets go of it.
// A drop segment is its own thing and a "done" mark has no weight to warm up
// with; neither is offered the switch.

const MOVED_OPTIONS: { value: "clean" | "grind" | "missed"; label: string; hue: string }[] = [
  { value: "clean", label: "All Clean", hue: "mv-clean" },
  { value: "grind", label: "Last One Was a Grind", hue: "mv-grind" },
  { value: "missed", label: "Missed One", hue: "mv-missed" },
];

type Field = ReturnType<typeof fieldsFor>[number];

export default function SetSheet({ title, kind, fields, entry, moveTracking = false, planned = false, onSave, onSkip, onDuplicate, onDelete, onCancel }: {
  /** The set's own name: "Set 2", "Warm-Up", "Drop". */
  title: string;
  kind: MeasureKind;
  /** The kind's fields, from fieldsFor. Weight leads here whatever order the
   *  planning strip uses, because the Now row leads with it too (C10). */
  fields: Field[];
  entry: SetEntry;
  moveTracking?: boolean;
  /** A PLANNED SET, NOT A LOGGED ONE (2026-10-17, defect C): the dashed Set 2
   *  and Set 3 rows open here to change this session's plan. Nothing has
   *  happened yet, so there is no warm-up switch and no How Did It Move; the
   *  moves offered are whichever of Duplicate and Delete the caller gives. */
  planned?: boolean;
  onSave: (patch: Partial<SetEntry>) => void;
  onSkip?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const ordered = [...fields].sort((a, b) => (a.key === "w" ? -1 : b.key === "w" ? 1 : 0));
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(ordered.map((f) => [f.key, entry[f.key] ? String(entry[f.key]) : ""])));
  const [moved, setMoved] = useState<SetEntry["moved"]>(entry.moved);
  const [warm, setWarm] = useState(!!entry.warmup);
  const save = () => {
    // A planned set has not happened: no mark and no warm-up flag to write.
    const patch: Partial<SetEntry> = planned ? {} : { moved: warm ? undefined : moved, warmup: warm ? true : undefined };
    for (const f of ordered) {
      const n = Number(vals[f.key]);
      (patch as Record<string, unknown>)[f.key] = vals[f.key]?.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
    }
    onSave(patch);
  };
  return (
    <FormSheet title={title} onCancel={onCancel} onSave={save} dirty={moved !== entry.moved || warm !== !!entry.warmup}>
      {/* THE KIND OF SET, FIRST: it changes what the rest of the sheet says. */}
      {kind !== "done" && !entry.drop && !planned && (
        <Group>
          <SwitchRow tone="yellow" glyph={<Flame className="ic" />} label="Warm-Up Set" ariaLabel="Warm-up set"
            // SAYS WHAT IT DOES TO THE COUNT (mockup 5, "clear warm-up
            // logic"): on, the set leaves the working sets (and the records
            // with them); off, it is one of the working sets.
            meta={warm ? "Not a Working Set" : "Counts as a Working Set"}
            on={warm} onToggle={() => setWarm((w) => !w)} />
        </Group>
      )}
      {kind === "done" ? (
        <Group>
          <Row label={entry.done ? "Done" : "Mark Done"} onClick={() => onSave({ done: !entry.done, skipped: false })} />
        </Group>
      ) : (
        <Group>
          {ordered.map((f) => (
            <FieldRow key={f.key} label={f.label} value={vals[f.key] ?? ""} inputMode={f.key === "r" ? "numeric" : "decimal"}
              onChange={(v) => setVals((s) => ({ ...s, [f.key]: v }))} ariaLabel={`${title} ${f.label.toLowerCase()}`} />
          ))}
        </Group>
      )}
      {/* HOW IT MOVED (catalog §4.5): observable events, never a feelings
          scale. Optional; tapping the active chip clears it. A warm-up and a
          drop are not the work and carry no mark (D6). */}
      {moveTracking && !planned && !entry.skipped && !warm && !entry.drop && (
        <Group label="How Did It Move?">
          {/* row-tap: the three chips are the row; a tap on the gap between
              them must not pick one for the athlete */}
          <div className="row xs-row xs-strip">
            <div className="chip-row chip-wrap-row">
              {MOVED_OPTIONS.map((o) => (
                <div key={o.value} className={"chip mv " + o.hue + (moved === o.value ? " active" : "")} role="button" tabIndex={0}
                  aria-pressed={moved === o.value}
                  onClick={() => setMoved(moved === o.value ? undefined : o.value)}>
                  {o.label}
                </div>
              ))}
            </div>
          </div>
        </Group>
      )}
      {(onSkip || onDuplicate || onDelete) && (
        <Group className="xs-actions">
          {onSkip && <Row label={entry.skipped ? "Unskip This Set" : "Skip This Set"} onClick={onSkip} />}
          {onDuplicate && <Row label="Duplicate This Set" onClick={onDuplicate} />}
          {onDelete && <DeleteRow label="Delete This Set" onClick={onDelete} />}
        </Group>
      )}
    </FormSheet>
  );
}
