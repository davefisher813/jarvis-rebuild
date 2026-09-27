import { useState } from "react";
import { FormSheet, Group, FieldRow, Row, DeleteRow } from "../shared/FormSheet";
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

const MOVED_OPTIONS: { value: "clean" | "grind" | "missed"; label: string; hue: string }[] = [
  { value: "clean", label: "All Clean", hue: "mv-clean" },
  { value: "grind", label: "Last One Was a Grind", hue: "mv-grind" },
  { value: "missed", label: "Missed One", hue: "mv-missed" },
];

type Field = ReturnType<typeof fieldsFor>[number];

export default function SetSheet({ title, kind, fields, entry, moveTracking = false, onSave, onSkip, onDuplicate, onDelete, onCancel }: {
  /** The set's own name: "Set 2", "Warm-Up", "Drop". */
  title: string;
  kind: MeasureKind;
  /** The kind's fields, from fieldsFor. Weight leads here whatever order the
   *  planning strip uses, because the Now row leads with it too (C10). */
  fields: Field[];
  entry: SetEntry;
  moveTracking?: boolean;
  onSave: (patch: Partial<SetEntry>) => void;
  onSkip: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const ordered = [...fields].sort((a, b) => (a.key === "w" ? -1 : b.key === "w" ? 1 : 0));
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(ordered.map((f) => [f.key, entry[f.key] ? String(entry[f.key]) : ""])));
  const [moved, setMoved] = useState<SetEntry["moved"]>(entry.moved);
  const save = () => {
    const patch: Partial<SetEntry> = { moved };
    for (const f of ordered) {
      const n = Number(vals[f.key]);
      (patch as Record<string, unknown>)[f.key] = vals[f.key]?.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
    }
    onSave(patch);
  };
  return (
    <FormSheet title={title} onCancel={onCancel} onSave={save} dirty={moved !== entry.moved}>
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
      {moveTracking && !entry.skipped && !entry.warmup && !entry.drop && (
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
      <Group className="xs-actions">
        <Row label={entry.skipped ? "Unskip This Set" : "Skip This Set"} onClick={onSkip} />
        <Row label="Duplicate This Set" onClick={onDuplicate} />
        <DeleteRow label="Delete This Set" onClick={onDelete} />
      </Group>
    </FormSheet>
  );
}
