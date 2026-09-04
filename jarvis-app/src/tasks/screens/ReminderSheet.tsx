import { useState } from "react";
import { DAY_PRESETS } from "../reminders";
import type { ReminderInfo } from "../../notes/types";
import { automaticityOf, automaticityLine } from "../automaticity";
import { FormSheet, Group, Row, FieldRow, MenuRow, Strip, Note, DeleteRow, ErrorLine } from "../../shared/FormSheet";
import { Clock, CalendarPlus } from "../../shared/icons";
import { BellGlyph, RepeatGlyph, WarningGlyph } from "../../shared/glyphs";

// TWO TAPS (Dave 2026-08-19). A reminder needs a name, a time, and how often.
// That is the entire form. No category, no duration, no end date, no project,
// no notes: every field this sheet does NOT have is a field the task sheet has
// and a reason "just remind me to take my meds" used to feel like paperwork.
//
// ON THE SHEET BAR (2026-09-02, the last form sheets): the name as the row,
// the time typed at the right with the hours real reminders land on as a
// strip under it (Dave 2026-08-21: "no need for the time box to take up the
// whole screen"), Repeat and If You Miss It as menus.
const QUICK_TIMES = [
  { v: "07:00", label: "7 AM" }, { v: "08:00", label: "8 AM" },
  { v: "12:00", label: "12 PM" }, { v: "18:00", label: "6 PM" },
  { v: "21:00", label: "9 PM" },
];

const sameDays = (a?: number[], b?: number[]) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return [...a].sort().join() === [...b].sort().join();
};

export default function ReminderSheet({
  initial,
  mode = "new",
  onSave,
  onDelete,
  onAddToCalendar,
  onCancel,
}: {
  initial?: { text: string; reminder: ReminderInfo };
  mode?: "new" | "edit";
  onSave: (text: string, r: ReminderInfo) => void;
  onDelete?: () => void;
  onAddToCalendar?: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [time, setTime] = useState(initial?.reminder.time ?? "08:00");
  const auto = automaticityOf(initial?.reminder.doneCount ?? 0);
  const autoLine = automaticityLine(auto);
  const [days, setDays] = useState<number[] | undefined>(initial?.reminder.days);
  const [onMiss, setOnMiss] = useState<"nag" | "let_go">(initial?.reminder.onMiss ?? "nag");
  const [err, setErr] = useState(false);
  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save creates
  // a reminder, so two taps created two. The first valid tap latches.
  const [saving, setSaving] = useState(false);
  const preset = DAY_PRESETS.find((p) => sameDays(days, p.days));

  const save = () => {
    if (!text.trim()) { setErr(true); return; }
    if (saving) return;
    setSaving(true);
    onSave(text.trim(), { ...initial?.reminder, time, days, onMiss });
  };

  return (
    <FormSheet title={mode === "edit" ? "Reminder" : "New Reminder"} onCancel={onCancel} onSave={save} saveDisabled={!text.trim()} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="Reminder">
        <FieldRow tone="orange" glyph={<BellGlyph />} value={text} onChange={(v) => { setText(v); setErr(false); }} placeholder="Meds"
          ariaLabel="Reminder" error={err && !text.trim()} right={false} onEnter={save} />
      </Group>
      <ErrorLine text={err && !text.trim() ? "Add a name." : null} />
      <Group label="When">
        <FieldRow tone="blue" glyph={<Clock className="ic" />} label="Time" type="time" value={time} onChange={setTime} ariaLabel="Time" />
        <Strip>
          {QUICK_TIMES.map((q) => (
            <div
              key={q.v}
              className={"chip" + (time === q.v ? " active" : "")}
              role="button"
              tabIndex={0}
              aria-pressed={time === q.v}
              onClick={() => setTime(q.v)}
            >{q.label}</div>
          ))}
        </Strip>
        <MenuRow tone="sky" glyph={<RepeatGlyph />} label="Repeat" value={preset?.label ?? ""} word={preset?.label ?? "Custom"} ariaLabel="Repeat"
          options={DAY_PRESETS.map((p) => ({ value: p.label, label: p.label }))}
          onPick={(v) => setDays(DAY_PRESETS.find((p) => p.label === v)?.days)} />
        <MenuRow tone="sand" glyph={<WarningGlyph />} label="If You Miss It" value={onMiss} ariaLabel="If you miss it"
          options={[{ value: "nag", label: "Ask Again in 15m" }, { value: "let_go", label: "Let It Go" }]}
          onPick={(v) => setOnMiss(v as "nag" | "let_go")} />
      </Group>
      {/* D1 · REPETITIONS, NOT STREAKS (2026-08-20). Keller et al. 2021:
          what predicted automaticity was how often the plan was actually
          enacted, median 59 days among those who formed the habit. So this
          counts what he DID. Nothing resets, there is no run to lose, and
          it never mentions misses. */}
      {autoLine && (
        <Group label="So Far">
          <Strip plain>
            <div className="auto-line">
              <div className="auto-bar"><span style={{ width: Math.round(auto.progress * 100) + "%" }} /></div>
              <div className="auto-text">{autoLine}</div>
            </div>
          </Strip>
        </Group>
      )}
      {mode === "edit" && (onAddToCalendar || onDelete) && (
        <>
          <Group className="xs-actions">
            {/* THE HONEST LINE (2026-08-19). A web app cannot fire its own
                alarm on iOS, so rather than let a reminder look like it will
                ping and quietly not, JARVIS says so and hands the job to the
                scheduler already on the phone. */}
            {onAddToCalendar && <Row tone="red" glyph={<CalendarPlus className="ic" />} label="Add to iPhone Calendar" onClick={onAddToCalendar} chev />}
            {onDelete && <DeleteRow label="Delete Reminder" onClick={onDelete} />}
          </Group>
          {onAddToCalendar && <Note>JARVIS can't send alerts on the web yet. Your Calendar can, and it works offline.</Note>}
        </>
      )}
    </FormSheet>
  );
}
