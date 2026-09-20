import { useState } from "react";
import { FormSheet, Group, FieldRow, Note, ErrorLine } from "../shared/FormSheet";
import { isDate, dayOffLabel } from "./daysOff";

// MARKING A DAY OFF (Track 3, 2026-09-19).
//
// One field, because a day off is one fact. Two things it is careful about:
//
//   IT READS THE DAY BACK IN WORDS the moment the field holds one. A date field
//   shows digits, and a mistyped month takes the wrong day out of his calendar
//   without anything looking wrong.
//
//   THE SAVE IS DIMMED BUT STILL TAPPABLE, which is this app's own convention
//   (see shared/SheetBar): the tap is what surfaces the missing thing. So a tap
//   with nothing in the field says what is missing rather than doing nothing,
//   which is a dead button wearing a dim class.
export default function DayOffSheet({ taken, busy, error, onCancel, onAdd }: {
  /** The days already off, so the same one cannot be added twice. */
  taken: string[];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onAdd: (date: string) => void;
}) {
  const [date, setDate] = useState("");
  const [missing, setMissing] = useState<string | null>(null);
  const good = isDate(date);
  const already = good && taken.includes(date);

  const save = () => {
    if (already) return; // said inline, below the field
    if (!good) {
      setMissing(date.length > 0 ? "That is not a day on the calendar." : "Pick a day first.");
      return;
    }
    setMissing(null);
    onAdd(date);
  };

  return (
    <FormSheet
      title="A Day Off"
      onCancel={onCancel}
      onSave={save}
      saveDisabled={busy || !good || already}
      saveLabel={busy ? "Saving" : "Mark It Off"}
    >
      <Group label="The Day">
        <FieldRow
          ariaLabel="The day"
          type="date"
          value={date}
          onChange={(v) => { setDate(v); setMissing(null); }}
          placeholder="YYYY-MM-DD"
          error={date.length > 0 && !good}
        />
      </Group>
      {good && <Note>{dayOffLabel(date)}</Note>}
      <Note>Nobody can book you on a day that is off</Note>
      {already && <ErrorLine text="That day is already off." />}
      <ErrorLine text={missing} />
      <ErrorLine text={error} />
    </FormSheet>
  );
}
