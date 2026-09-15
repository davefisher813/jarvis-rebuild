import { useState } from "react";
import { FormSheet, Group, FieldRow, Strip, Note, ErrorLine } from "../../shared/FormSheet";
import { Calendar, Clock } from "../../shared/icons";
import { pressable } from "../../shared/pressable";
import { addDays } from "../../schedule/calendar";
import { inMinutes, morningTime } from "../quickReminder";

// CHOOSE A BETTER TIME (the reminders rebuild push E, Dave's interactive
// preview). One occurrence moves; the schedule stays. Four quick answers,
// then a day and a time for anything else, and Use This Time on the bar.

export default function SnoozeSheet({ title, fromDate, today, now = Date.now(), onPick, onCancel }: {
  title: string;
  /** The occurrence being moved. */
  fromDate: string;
  today: string;
  now?: number;
  onPick: (toDate: string, time: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(fromDate);
  const [time, setTime] = useState("");
  const [err, setErr] = useState(false);
  const m15 = inMinutes(now, 15);
  const h1 = inMinutes(now, 60);
  const evening = { day: today, time: "18:00" };
  const tomorrow = { day: addDays(today, 1), time: morningTime() };
  const chip = (label: string, pick: { day: string; time: string }, key: string) => (
    <div key={key} {...pressable(() => onPick(pick.day, pick.time))} className="chip">{label}</div>
  );
  const save = () => {
    if (!/^\d{2}:\d{2}$/.test(time) || !date) { setErr(true); return; }
    onPick(date, time);
  };
  return (
    <FormSheet title="Choose a Better Time" onCancel={onCancel} onSave={save} saveLabel="Use This Time">
      <Group label={title}>
        <Note>Only this occurrence changes · The schedule stays the same</Note>
        <Strip>
          {chip("In 15 Minutes", m15, "m15")}
          {chip("In 1 Hour", h1, "h1")}
          {chip("This Evening", evening, "ev")}
          {chip("Tomorrow", tomorrow, "tm")}
        </Strip>
      </Group>
      <Group label="Or Pick a Time">
        <FieldRow tone="indigo" glyph={<Calendar className="ic" />} label="Day" type="date" value={date} onChange={(v) => { setDate(v); setErr(false); }} ariaLabel="Move to day" />
        <FieldRow tone="blue" glyph={<Clock className="ic" />} label="Time" type="time" value={time} onChange={(v) => { setTime(v); setErr(false); }} ariaLabel="Move to time" error={err} />
      </Group>
      <ErrorLine text={err ? "Pick a day and a time." : null} />
    </FormSheet>
  );
}
