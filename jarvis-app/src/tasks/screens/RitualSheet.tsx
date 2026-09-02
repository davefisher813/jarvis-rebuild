import { useState } from "react";
import { LENGTHS, endsAt, ritualIsReady, whyNotReady, type Ritual } from "../startRitual";
import { FormSheet, Group, Row, FieldRow, MenuRow, Note, ErrorLine } from "../../shared/FormSheet";
import { Clock, Hourglass, Zap } from "../../shared/icons";
import { SunriseGlyph } from "../../shared/glyphs";

// THE START RITUAL SHEET (C1). Three decisions, all pre-answered: when it
// starts, how long it runs, and what the first move is. He can change any of
// them, but the sheet opens with a complete plan already in it, because
// arriving at an empty form is the same wall the feature exists to remove.
//
// ON THE SHEET BAR (2026-09-02, the last form sheets): the task as the first
// row, Starts typed at the right, For as a menu, the first move as the row
// under its own head. Set It in the bar.
export default function RitualSheet({
  initial,
  onSet,
  onCancel,
}: {
  initial: Ritual;
  onSet: (r: Ritual) => void;
  onCancel: () => void;
}) {
  const [start, setStart] = useState(initial.startHHMM);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [firstMove, setFirstMove] = useState(initial.firstMove);
  const [touched, setTouched] = useState(false);

  const draft: Ritual = { ...initial, startHHMM: start, minutes, firstMove };
  const ready = ritualIsReady(draft);
  const why = whyNotReady(draft);
  const set = () => { if (ready) onSet(draft); else setTouched(true); };

  return (
    <FormSheet title="Set a Start" onCancel={onCancel} onSave={set} saveLabel="Set It" saveDisabled={!ready}>
      <Group label="Task">
        <Row tone="sky" glyph={<SunriseGlyph />} label={initial.text} />
      </Group>
      <Group label="Plan">
        <FieldRow tone="orange" glyph={<Clock className="ic" />} label="Starts" type="time" value={start} onChange={setStart} ariaLabel="Starts" />
        <MenuRow tone="blue" glyph={<Hourglass className="ic" />} label="For" value={String(minutes)} word={minutes + "m"} ariaLabel="For"
          options={LENGTHS.map((m) => ({ value: String(m), label: m + "m" }))} onPick={(v) => setMinutes(Number(v))} />
      </Group>
      {ready && <Note>Ends {endsAt(draft)}. Finishing is not the point.</Note>}
      <Group label="First Move">
        <FieldRow tone="green" glyph={<Zap className="ic" />} value={firstMove} onChange={setFirstMove} placeholder="e.g. open the template"
          ariaLabel="First move" error={touched && !!why} right={false} onEnter={set} />
      </Group>
      <ErrorLine text={why && (touched || firstMove.trim()) ? why : null} />
    </FormSheet>
  );
}
