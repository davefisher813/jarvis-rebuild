import { useState } from "react";
import { FormSheet, Tile, tapField } from "../../shared/FormSheet";
import { ClockGlyph } from "../../shared/glyphs";
import { DUR_CHOICES, durLabel } from "../durations";
import { nudgeStart } from "../eventMoves";

// THE RETIME SHEET (2026-10-01, schedule audit item 4: "moving items is
// inflexible"). Tapping the time on a row used to open a small popover that
// hung under the row inside the list, which is a container with an overflow
// clip, a swipe transform and the page behind it. It was reachable on a good
// day and invisible on a bad one (off the foot of a short list, behind the
// capture bar, inside a closed rail), and it committed on the first change
// of the clock input, so a fat finger on a spinner wheel was a write.
//
// This is a sheet instead: portalled to the body, so nothing above it can
// clip it, and it holds a DRAFT. The start is the native time input plus four
// chips that nudge it, the length is the shared duration chips, and nothing is
// written until Save, which hands the caller both halves in one call so the
// caller can commit them as one move with one Undo.
//
// The chips REFUSE rather than clamp (nudgeStart): a nudge that pins at
// midnight and quietly shortens the block is a resize in disguise.

const NUDGES: [number, string][] = [[-30, "−30m"], [-15, "−15m"], [15, "+15m"], [30, "+30m"]];

export default function RetimeSheet({
  title,
  start,
  minutes,
  onSave,
  onCancel,
}: {
  /** The event's name, so the sheet says what it is moving. */
  title: string;
  /** "HH:MM" the event starts now. */
  start: string;
  /** How long it runs now, or null when it has no end. */
  minutes: number | null;
  /** The draft, once. `minutes` is null when no length is set. */
  onSave: (start: string, minutes: number | null) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(start);
  const [dur, setDur] = useState<number | null>(minutes);
  const dirty = s !== start || dur !== minutes;
  return (
    <FormSheet
      title="Change Time"
      saveLabel="Move"
      dirty={dirty}
      onCancel={onCancel}
      onSave={() => (dirty ? onSave(s, dur) : onCancel())}
    >
      <div className="grp xs-grp"><div className="eyebrow">{title}</div></div>
      <div className="pad-x"><div className="card xs-group">
        <div onClick={tapField} className="row xs-row">
          <Tile tone="green"><ClockGlyph /></Tile>
          <div className="conn-name">Starts</div>
          <input
            type="time"
            className="xs-input xs-field"
            aria-label="New time"
            value={s}
            onChange={(ev) => { if (ev.target.value) setS(ev.target.value); }}
          />
        </div>
        {/* row-tap: chip strip, each chip its own pick; the strip is not an item */}
        <div className="row xs-strip">
          <div className="chip-row">
            {NUDGES.map(([delta, label]) => {
              const next = nudgeStart(s, delta, dur);
              return (
                <button
                  key={delta}
                  type="button"
                  className={"chip" + (next === null ? " chip-off" : "")}
                  aria-disabled={next === null}
                  aria-label={(delta < 0 ? "Earlier by " : "Later by ") + Math.abs(delta) + " minutes"}
                  onClick={() => { if (next !== null) setS(next); }}
                >{label}</button>
              );
            })}
          </div>
        </div>
      </div></div>
      <div className="grp xs-grp"><div className="eyebrow">How Long</div></div>
      <div className="pad-x"><div className="card xs-group">
        <div className="row xs-strip">
          <div className="chip-row">
            {DUR_CHOICES.map((d) => (
              <button
                key={d}
                type="button"
                className={"chip" + (dur === d ? " on" : "")}
                aria-pressed={dur === d}
                aria-label={title + ": " + d + " minutes"}
                onClick={() => setDur(d)}
              >{durLabel(d)}</button>
            ))}
          </div>
        </div>
      </div></div>
    </FormSheet>
  );
}
