import { useState } from "react";

// THE STEPPER (B7, 2026-08-23). One implementation, the way InlineEdit,
// ChipPicker, ReorderList, useSwipe and undoStack are each one.
//
// It existed twice: a full one in gym/ExerciseSheet and a stripped one in
// gym/SessionScreen that dropped the single feature that makes a stepper
// usable. Nothing caught it, because a stepper was not one of the five
// law-protected primitives. Now it is six, and editingPrimitives.test.ts
// says so.
//
// THE RULE THIS ENCODES (approved preview 2026-08-15): tap the number to
// TYPE it. Steppers nudge, the keypad jumps. Going from 0 to 185 is one tap
// and three digits, not thirty-seven taps. A stepper without the keypad
// escape is the version that gets abandoned halfway.
//
// Where a stepper is the WRONG control, and this is already decided: block
// durations. PlanDaySheet's comment records it: 45m to 2h was five taps on
// a stepper and chips do it in one. Steppers are for values with no useful
// preset set (weight, reps, money), chips for values with one.

export default function Stepper({
  value, step, onChange, min = 0, max, label,
}: {
  value: number;
  step: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  // Names the VALUE for a screen reader, since "Less" and "More" alone do not
  // say less and more of what when several steppers share a card.
  label?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  const clamp = (n: number) => {
    const lo = Math.max(min, n);
    return Number((max === undefined ? lo : Math.min(max, lo)).toFixed(2));
  };
  const dec = () => onChange(clamp(value - step));
  const inc = () => onChange(clamp(value + step));

  const commit = () => {
    if (editing !== null) {
      const n = Number(editing);
      if (Number.isFinite(n)) onChange(clamp(n));
    }
    setEditing(null);
  };

  return (
    <div className="stepper">
      <button type="button" aria-label={label ? "Less " + label : "Less"}
        disabled={value <= min} onClick={dec}>&minus;</button>
      <div className="sep" />
      {editing === null ? (
        <div className="val stepper-tap" role="button" tabIndex={0}
          aria-label={label}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditing(String(value)); } }}
          onClick={() => setEditing(String(value))}>{value}</div>
      ) : (
        <input
          className="val stepper-edit"
          inputMode="decimal"
          aria-label={label}
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          onFocus={(e) => e.target.select()}
        />
      )}
      <div className="sep" />
      <button type="button" aria-label={label ? "More " + label : "More"}
        disabled={max !== undefined && value >= max} onClick={inc}>+</button>
    </div>
  );
}
