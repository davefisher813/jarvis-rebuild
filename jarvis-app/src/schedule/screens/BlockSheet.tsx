import { useState } from "react";
import { minToHHMM } from "../calendar";
import { DUR_CHOICES, durLabel } from "../durations";
import { FormSheet, Group, Row, FieldRow, MenuRow, Strip, DeleteRow, ErrorLine } from "../../shared/FormSheet";
import { Clock, Hourglass, CalendarDays, PenLine } from "../../shared/icons";
import { LockGlyph } from "../../shared/glyphs";

// THE SAME TAP AS A REAL EVENT (2026-08-28). Dave, all caps: "when I click on
// something in the schedule it should allow me to edit it like a normal
// scheduled event" - not the full Your Routine screen (Quick Add presets,
// nine kinds, What Happens in This Block, Where), which is a settings page,
// not a quick edit. This is EventSheet's shape - name, time, Move, Length,
// Save, Delete, Cancel - carrying only what a tap from the schedule should
// ever need to touch. Kind, mode, Flexible and location are untouched by it;
// "Edit Full Details" below is the one link out to the page that owns those.
//
// ON THE SHEET BAR (2026-09-02, the last form sheets): the event sheet's own
// anatomy, since it is the event sheet's own shape. Start and End typed at
// the right, Length a menu, Move a strip, the days a strip of letters.

const DOW_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

// Same shift amounts as EventSheet's Move row. No "Tomorrow": a block is a
// weekly rule, not a single date, so there is no single day to bump.
const NUDGES: [number, string][] = [[-30, "-30m"], [-15, "-15m"], [15, "+15m"], [30, "+30m"]];

export interface BlockDraft {
  label: string;
  startMin: number;
  endMin: number;
  days: number[];
}

export default function BlockSheet({
  initial,
  onSave,
  onDelete,
  onEditFull,
  onCancel,
}: {
  initial: BlockDraft;
  onSave: (draft: BlockDraft) => void;
  onDelete?: () => void;
  // The escape hatch to the full Your Routine editor, for kind, mode,
  // Flexible and location - everything this quick sheet deliberately leaves
  // alone.
  onEditFull?: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [start, setStart] = useState(minToHHMM(initial.startMin));
  const [end, setEnd] = useState(minToHHMM(initial.endMin));
  const [days, setDays] = useState<number[]>([...initial.days]);
  const [err, setErr] = useState(false);

  // Keep end sensible, same rule as EventSheet: when start moves past end,
  // push end to start + 1h rather than asking for it. End genuinely has a
  // good default; only a name, a start and at least one day cannot be
  // invented for a block.
  const onStartChange = (v: string) => {
    setStart(v);
    if (!end || toMin(end) <= toMin(v)) setEnd(minToHHMM(Math.min(24 * 60 - 1, toMin(v) + 60)));
    if (err) setErr(false);
  };
  const endInvalid = !!end && toMin(end) <= toMin(start);
  const toggleDay = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort((a, b) => a - b)));
  const dur = end && toMin(end) > toMin(start) ? toMin(end) - toMin(start) : 0;
  const durValue = DUR_CHOICES.includes(dur) ? String(dur) : "";
  const durWord = dur > 0 ? durLabel(dur) : "None";

  const save = () => {
    if (!label.trim() || !start || !end || endInvalid || days.length === 0) {
      setErr(true);
      return;
    }
    onSave({ label: label.trim(), startMin: toMin(start), endMin: toMin(end), days: [...days].sort((a, b) => a - b) });
  };

  return (
    <FormSheet title="Edit Protected Time" onCancel={onCancel} onSave={save}>
      <Group label="Block">
        <FieldRow tone="teal" glyph={<LockGlyph />} value={label} onChange={(v) => { setLabel(v); if (err) setErr(false); }}
          placeholder="Gym · Lunch · Deep Work" ariaLabel="Block name" error={err && !label.trim()} right={false} />
      </Group>
      <Group label="When">
        <FieldRow tone="orange" glyph={<Clock className="ic" />} label="Start" type="time" value={start} onChange={onStartChange} ariaLabel="Start" />
        <FieldRow tone="orange" glyph={<Clock className="ic" />} label="End" type="time" value={end} onChange={(v) => { setEnd(v); if (err) setErr(false); }}
          ariaLabel="End" error={endInvalid} />
        <MenuRow tone="blue" glyph={<Hourglass className="ic" />} label="Length" value={durValue} word={durWord} ariaLabel="Length" off={dur === 0}
          options={DUR_CHOICES.map((m) => ({ value: String(m), label: durLabel(m) }))}
          onPick={(v) => { setEnd(minToHHMM(toMin(start) + Number(v))); if (err) setErr(false); }} />
        <Strip>
          {NUDGES.map(([mins, nudgeLabel]) => {
            const nextStart = toMin(start) + mins;
            const blocked = nextStart < 0 || nextStart + dur > 24 * 60 - 1;
            return (
              <div
                key={mins}
                className={"chip" + (blocked ? " chip-off" : "")}
                role="button"
                tabIndex={blocked ? -1 : 0}
                aria-disabled={blocked}
                onClick={() => {
                  if (blocked) return;
                  setStart(minToHHMM(nextStart));
                  setEnd(minToHHMM(nextStart + dur));
                  if (err) setErr(false);
                }}
              >
                {nudgeLabel}
              </div>
            );
          })}
        </Strip>
      </Group>
      <ErrorLine text={endInvalid ? "End must be after start" : null} />
      <Group label="Days">
        <Row tone="sky" glyph={<CalendarDays className="ic" />} label="Every">
          <span className="xs-field xs-days">{days.length === 7 ? "Day" : days.length === 0 ? "None" : days.map((d) => DOW_ABBR[d]).join(" ")}</span>
        </Row>
        <Strip>
          {DOW_LETTER.map((ltr, d) => (
            <div
              key={d}
              className={"chip" + (days.includes(d) ? " active" : "")}
              role="button"
              tabIndex={0}
              aria-pressed={days.includes(d)}
              aria-label={DOW_ABBR[d]}
              onClick={() => { toggleDay(d); if (err) setErr(false); }}
            >{ltr}</div>
          ))}
        </Strip>
      </Group>
      <ErrorLine text={err && !endInvalid ? "Needs a name · At least one day" : null} />
      {(onEditFull || onDelete) && (
        <Group className="xs-actions">
          {onEditFull && <Row tone="graphite" glyph={<PenLine className="ic" />} label="Edit Full Details" onClick={onEditFull} chev />}
          {onDelete && <DeleteRow label="Delete Block" onClick={onDelete} />}
        </Group>
      )}
    </FormSheet>
  );
}
