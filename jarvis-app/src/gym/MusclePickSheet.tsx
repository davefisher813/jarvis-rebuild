import { useState } from "react";
import { createPortal } from "react-dom";
import SheetBar from "../shared/SheetBar";
import { showToast } from "../shared/toast";
import { MUSCLE_LABEL, type MuscleGroup } from "./muscles";

// THE MUSCLES, PICKED WHERE THE EXERCISE IS (Dave 2026-10-09, mockup 8,
// "Secondary Muscles Selector, multi-select chips"). Opened from the Primary
// and Secondary chips on the logging view's header, so a lift can be told what it
// trains between sets without a trip to the library. It writes the same
// classification the library's own editor writes (classify.ts), so the
// library, the workout and Insights read one answer.
//
// The look is ClassifySheet's, on purpose: a primary muscle is the filled lime
// chip, a secondary one the half chip, and nothing here is ever red (red is a
// verb, never "selected"). The groups are the twelve the app counts sets by;
// the mockup's extra muscles are not in that list, so they are not offered.

export const MUSCLE_SECTIONS: { label: string; muscles: MuscleGroup[] }[] = [
  { label: "Upper Body", muscles: ["chest", "back", "traps", "shoulders", "biceps", "triceps", "forearms"] },
  { label: "Lower Body", muscles: ["quads", "hamstrings", "glutes", "calves"] },
  { label: "Core", muscles: ["core"] },
];

/** The most secondary muscles one exercise carries (mockup 8: "Select 1 to 3
 *  secondary muscles"). Each counts half a set, and a lift that "also" trains
 *  half the body is not telling the weekly count anything. */
export const MAX_SECONDARY = 3;

export interface MusclePick { primary: MuscleGroup[]; secondary: MuscleGroup[] }

/** One tap, as the sheet takes it. Pure, so the rules are tested without a
 *  render: a muscle holds one role at a time, and a fourth secondary is
 *  refused rather than quietly dropping the first. */
export function tapMuscle(cur: MusclePick, role: "primary" | "secondary", m: MuscleGroup): MusclePick | "full" {
  if (role === "primary") {
    if (cur.primary.includes(m)) return { ...cur, primary: cur.primary.filter((x) => x !== m) };
    return { primary: [...cur.primary, m], secondary: cur.secondary.filter((x) => x !== m) };
  }
  if (cur.primary.includes(m)) return cur;
  if (cur.secondary.includes(m)) return { ...cur, secondary: cur.secondary.filter((x) => x !== m) };
  if (cur.secondary.length >= MAX_SECONDARY) return "full";
  return { ...cur, secondary: [...cur.secondary, m] };
}

export default function MusclePickSheet({ name, role, initial, onSave, onCancel }: {
  name: string;
  role: "primary" | "secondary";
  initial: MusclePick;
  onSave: (next: MusclePick) => void;
  onCancel: () => void;
}) {
  const [pick, setPick] = useState<MusclePick>(initial);
  const tap = (m: MuscleGroup) => {
    const next = tapMuscle(pick, role, m);
    if (next === "full") { showToast({ message: `Up to ${MAX_SECONDARY} Secondary Muscles` }); return; }
    setPick(next);
  };
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar title={role === "primary" ? "Primary" : "Secondary"} onCancel={onCancel} saveLabel="Done" onSave={() => onSave(pick)} />
        <div className="sheet-form">
          {MUSCLE_SECTIONS.map((sec) => (
            <div key={sec.label}>
              <div className="grp xs-grp"><div className="eyebrow">{sec.label}</div></div>
              <div className="pad-x"><div className="card xs-group">
                {/* row-tap: chip strip, every inch of it is one of the muscle chips */}
                <div className="row xs-row">
                  <div className="chip-row chip-wrap-row">
                    {sec.muscles.map((m) => {
                      const isPrimary = pick.primary.includes(m);
                      const isSecondary = pick.secondary.includes(m);
                      // On the secondary sheet a primary muscle is shown filled
                      // and cannot be tapped: it already has the stronger role.
                      const locked = role === "secondary" && isPrimary;
                      const on = role === "primary" ? isPrimary : isSecondary;
                      return (
                        <button key={m} type="button"
                          className={"chip" + (isPrimary ? " active chip-lime" : isSecondary ? " chip-half chip-lime" : "")}
                          aria-pressed={on} disabled={locked}
                          aria-label={`${MUSCLE_LABEL[m]}${isPrimary ? ", primary" : isSecondary ? ", secondary" : ""}`}
                          onClick={() => tap(m)}>
                          {MUSCLE_LABEL[m]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div></div>
            </div>
          ))}
          {role === "secondary" && (
            <div className="pad-x"><div className="facts"><span className="fact">{`Pick Up to ${MAX_SECONDARY}`}</span></div></div>
          )}
          <div className="xs-foot" />
          {/* The title is the chip's own word (Primary, Secondary): the sheet
              bar holds a short title beside Done, and the chips under it are
              plainly muscles. */}
        </div>
      </div>
    </div>,
    document.body,
  );
}
