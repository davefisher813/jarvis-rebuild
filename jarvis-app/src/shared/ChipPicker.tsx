import { useState } from "react";
import { haptics } from "./haptics";

// THE chip-picker primitive (editing coverage map, universal mechanics):
// chips edit structured fields with ONE-FIELD in-place pickers, never forms.
// Closed, it is the value chip. Tapped, it becomes the option row where the
// tap on an option is both the answer and the save (no Save button, no
// sheet, no navigation). Esc-hatch: tapping the open chip again closes it
// unchanged.
//
// One implementation for every structured field (time, date, category,
// person, status, number-ish choices); surfaces configure options and
// rendering, never reimplement the mechanics.

export interface ChipOption {
  value: string;
  label: string;
  // Optional dot color slot (category chips keep their dot, per law).
  dot?: string;
}

export default function ChipPicker({
  value,
  options,
  onPick,
  ariaLabel,
}: {
  value: string;
  options: ChipOption[];
  onPick: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  if (!open) {
    return (
      <div className="chip" role="button" tabIndex={0} aria-label={ariaLabel} onClick={() => { haptics.selection(); setOpen(true); }}>
        {current?.dot && <span className={"cat-dot cat-bg-" + current.dot} />}
        {current?.label ?? "None"}
      </div>
    );
  }

  return (
    <div className="chip-row chip-picker-open" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <div
          key={o.value}
          className={"chip" + (o.value === value ? " active" : "")}
          role="radio"
          aria-checked={o.value === value}
          tabIndex={0}
          onClick={() => {
            haptics.selection();
            setOpen(false);
            if (o.value !== value) onPick(o.value);
          }}
        >
          {o.dot && <span className={"cat-dot cat-bg-" + o.dot} />}
          {o.label}
        </div>
      ))}
    </div>
  );
}
