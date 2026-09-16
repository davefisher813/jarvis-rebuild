import { useState } from "react";
import { createPortal } from "react-dom";
import SheetBar from "../shared/SheetBar";
import HeadMenu from "../shared/HeadMenu";
import {
  EQUIPMENT_KINDS, EQUIPMENT_LABEL, EQUIPMENT_NOTE, COUNTED_LABEL,
  countsFor, asksCount, styleSummary, type Counted, type Equipment, type LoadStyle,
} from "./equipment";

// HOW THIS LIFT LOADS, ANSWERABLE MID-SET (2026-09-16, Dave, four
// photographs of a live session: "I don't even have the option while I'm
// logging to select what type of weight system it is essentially. So it just
// always defaults to dumbbell weight, so the plate loading and all that is
// completely off if I'm not doing that. And then if I'm using dumbbells, it
// doesn't adjust for dumbbells... If it's a bilateral exercise versus
// unilateral, that should change things.")
//
// The three questions already existed -- in ClassifySheet, which is a
// LIBRARY editor: eight groups, a muscle grid, a scope question, and a save
// that rewrites an exercise's classification across its whole history. That
// is the right sheet for a quiet evening and the wrong one for a rack
// between sets. This is the same three answers, nothing else, opened from the
// chip that shows them.
//
// It is deliberately NOT a fourth place the convention is defined:
// equipment.ts owns every list, every label and every note here. This sheet
// only asks.
export default function LoadSheet({ name, initial, onSave, onCancel }: {
  name: string;
  initial: LoadStyle;
  onSave: (next: LoadStyle) => void;
  onCancel: () => void;
}) {
  const [style, setStyle] = useState<LoadStyle>(initial);
  const counts = countsFor(style.equipment);

  const pickEquipment = (e: Equipment | undefined) => {
    if (!e) { setStyle({ ...style, equipment: undefined, counted: undefined }); return; }
    // A reading the new equipment does not offer cannot survive the change:
    // "Each Hand" on a weight stack is not a reading, it is a leftover.
    const keep = style.counted && countsFor(e).includes(style.counted) ? style.counted : undefined;
    setStyle({ ...style, equipment: e, counted: keep });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar title={name} onCancel={onCancel} saveLabel="Save" onSave={() => onSave(style)} />
        <div className="sheet-form">
          <div className="grp xs-grp"><div className="eyebrow">Equipment</div></div>
          <div className="pad-x"><div className="card xs-group">
            {/* row-tap: chip strip, every inch of it is one of the answer chips */}
            <div className="row xs-row">
              <div className="chip-row chip-wrap-row">
                {EQUIPMENT_KINDS.map((e) => (
                  <button key={e} type="button" className={"chip" + (style.equipment === e ? " active" : "")}
                    aria-pressed={style.equipment === e} aria-label={`Equipment ${EQUIPMENT_LABEL[e]}`}
                    onClick={() => pickEquipment(style.equipment === e ? undefined : e)}>
                    {EQUIPMENT_LABEL[e]}
                  </button>
                ))}
              </div>
            </div>
            {/* The note is the equipment's own plain sentence, which is what
                makes Plate-Loaded Machine and Selectorized Machine tellable
                apart by someone standing in front of one of them. */}
            {style.equipment && EQUIPMENT_NOTE(style.equipment) && (
              <div className="row xs-row"><div className="row-grow"><div className="conn-meta">{EQUIPMENT_NOTE(style.equipment)}</div></div></div>
            )}
          </div></div>

          {asksCount(style.equipment) && (
            <>
              <div className="grp xs-grp"><div className="eyebrow">What the Number Means</div></div>
              <div className="pad-x"><div className="card xs-group">
                {/* row-tap: chip strip, every inch of it is one of the answer chips */}
                <div className="row xs-row">
                  <div className="chip-row chip-wrap-row">
                    {counts.map((x: Counted) => (
                      <button key={x} type="button" className={"chip" + (style.counted === x ? " active" : "")}
                        aria-pressed={style.counted === x} aria-label={`Counted as ${COUNTED_LABEL[x]}`}
                        onClick={() => setStyle({ ...style, counted: style.counted === x ? undefined : x })}>
                        {COUNTED_LABEL[x]}
                      </button>
                    ))}
                  </div>
                </div>
              </div></div>
            </>
          )}

          {/* THE REPS AXIS. Its own question because it is its own question: a
              dumbbell bench press is Each Hand with both arms pressing at
              once, and a single-arm cable row is a whole-stack number done one
              side at a time. */}
          <div className="grp xs-grp"><div className="eyebrow">Reps</div></div>
          <div className="pad-x"><div className="card xs-group">
            {/* A VALUE, NOT A SWITCH AND A SENTENCE (2026-09-16, Dave: "this
                is not a manual, we don't need instructions everywhere"). This
                row had a toggle and a line of grey under it explaining which
                way was on, because a toggle cannot say what it means. The two
                chips above state their answers in the right slot; so does
                this now, and the sentence is gone with the toggle.
                Same two answers ExerciseSheet's Reps Count row offers, in the
                same words, because they are the same question. */}
            <div className="row xs-row">
              <div className="conn-name">Reps Count</div>
              <HeadMenu variant="value" ariaLabel="Reps count" value={style.sided ? "side" : "both"}
                options={[{ value: "both", label: "Both Sides" }, { value: "side", label: "Per Side" }]}
                onPick={(v) => setStyle({ ...style, sided: v === "side" })} />
            </div>
          </div></div>

          {/* What the three answers add up to, in the words the session's own
              chip will use. One line, and it is a reading, not an
              instruction. */}
          <div className="pad-x"><div className="facts">
            <span className="fact">{styleSummary(style)}</span>
            {style.sided && <span className="fact">Reps Per Side</span>}
          </div></div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
