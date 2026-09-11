import { useState } from "react";
import { DAY_PRESETS } from "../reminders";
import type { ReminderInfo } from "../../notes/types";
import { automaticityOf, automaticityLine } from "../automaticity";
import { FormSheet, Group, Row, FieldRow, MenuRow, Strip, Note, DeleteRow, ErrorLine } from "../../shared/FormSheet";
import { Clock, CalendarPlus, Calendar, Tag } from "../../shared/icons";
import { BellGlyph, RepeatGlyph, WarningGlyph } from "../../shared/glyphs";
import { todayISO } from "../grouping";
import { addDays } from "../../schedule/calendar";

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

// A DAY, NOT JUST A CLOCK (Dave 2026-09-11: "Reminder modal is too limited. I
// can't even select a date for a reminder. Expand the booking options").
//
// He is right and the omission was structural, not an oversight of the form:
// a reminder is a TASK carrying a ReminderInfo, and this sheet only ever wrote
// the reminder half. So every reminder landed with no due date -- "remind me
// Thursday" was unsayable, and a one-off reminder was unsayable with it,
// because Repeat's only options were Every Day, Weekdays and Weekends. Three
// things are added, all of them fields the task entity already had:
//   the DAY it starts (the task's own `due`),
//   Just Once as a repeat, which is what a date without a rhythm means,
//   and the AREA, so "Meds" can live on the Health page like everything else.
const QUICK_DAYS = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "none", label: "No Date" },
];
/** Every Day / Weekdays / Weekends, plus the one-off the list never had. */
const ONCE = "Just Once";

const sameDays = (a?: number[], b?: number[]) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return [...a].sort().join() === [...b].sort().join();
};

export default function ReminderSheet({
  initial,
  mode = "new",
  categories = [],
  onSave,
  onDelete,
  onAddToCalendar,
  onCancel,
}: {
  initial?: { text: string; reminder: ReminderInfo; due?: string | null; category?: string };
  mode?: "new" | "edit";
  /** The areas this reminder can be filed to. Empty for a caller with none to
   *  hand, and the row then does not render, the same way the task sheet's
   *  Person and Project rows do not. */
  categories?: { id: string; name: string; color: string }[];
  onSave: (text: string, r: ReminderInfo, extra: { due: string | null; category: string }) => void;
  onDelete?: () => void;
  onAddToCalendar?: () => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial?.text ?? "");
  const [time, setTime] = useState(initial?.reminder.time ?? "08:00");
  const [due, setDue] = useState(initial?.due ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  // "Just Once" is the absence of a rhythm, so it is what the picker reads
  // when a date is set and no day pattern is: nothing new is stored for it.
  const [once, setOnce] = useState(!!initial?.due && !initial?.reminder.days);
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
    onSave(text.trim(), { ...initial?.reminder, time, days: once ? undefined : days, onMiss },
      { due: due || null, category });
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
        {/* THE DAY. It sits under the clock because a reminder is answered
            "at 8, on Thursday", never the other way round; the strip carries
            the two days a reminder is actually set for, and the field takes
            anything else. No Date is a real answer, and the one a daily
            reminder wants. */}
        <FieldRow tone="indigo" glyph={<Calendar className="ic" />} label="Day" type="date" value={due} onChange={(v) => { setDue(v); if (v) setOnce(true); }} ariaLabel="Day" />
        <Strip>
          {QUICK_DAYS.map((q) => {
            const v = q.key === "today" ? todayISO() : q.key === "tomorrow" ? addDays(todayISO(), 1) : "";
            const on = due === v;
            return (
              <div key={q.key} className={"chip" + (on ? " active" : "")} role="button" tabIndex={0} aria-pressed={on}
                onClick={() => { setDue(v); if (v) setOnce(true); else setOnce(false); }}>{q.label}</div>
            );
          })}
        </Strip>
        <MenuRow tone="sky" glyph={<RepeatGlyph />} label="Repeat" value={once ? ONCE : preset?.label ?? ""} word={once ? ONCE : preset?.label ?? "Custom"} ariaLabel="Repeat"
          options={[{ value: ONCE, label: ONCE }, ...DAY_PRESETS.map((p) => ({ value: p.label, label: p.label }))]}
          onPick={(v) => {
            if (v === ONCE) { setOnce(true); if (!due) setDue(todayISO()); return; }
            setOnce(false);
            setDays(DAY_PRESETS.find((p) => p.label === v)?.days);
          }} />
        <MenuRow tone="sand" glyph={<WarningGlyph />} label="If You Miss It" value={onMiss} ariaLabel="If you miss it"
          options={[{ value: "nag", label: "Ask Again in 15m" }, { value: "let_go", label: "Let It Go" }]}
          onPick={(v) => setOnMiss(v as "nag" | "let_go")} />
      </Group>
      {/* AND WHERE IT BELONGS. A reminder was the one thing in this app that
          could not be filed, so "Meds" never appeared on the Health page and
          nothing about it counted anywhere. Same picker, same ids, same dots
          as every other Area row. */}
      {categories.length > 0 && (
        <Group label="Where">
          <MenuRow tone="blue" glyph={<Tag className="ic" />} label="Area" value={category} ariaLabel="Area"
            word={categories.find((c) => c.id === category)?.name ?? "None"} off={category === ""}
            options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c.id, label: c.name, dot: c.color }))]}
            onPick={setCategory} />
        </Group>
      )}
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
                scheduler already on the phone.
                TODAY-F-03 (2026-09-05): the note under it went stale when
                S1-01 taught the phone to fire these itself, so it was telling
                him the app could not do the thing it had just started doing.
                The handoff is still worth offering, for the reason that is
                still true: a calendar entry outlives the app and rides to
                every device the calendar syncs to. */}
            {onAddToCalendar && <Row tone="red" glyph={<CalendarPlus className="ic" />} label="Add to iPhone Calendar" onClick={onAddToCalendar} chev />}
            {onDelete && <DeleteRow label="Delete Reminder" onClick={onDelete} />}
          </Group>
          {onAddToCalendar && <Note>Your Calendar can carry this too, and it keeps it if JARVIS ever goes.</Note>}
        </>
      )}
    </FormSheet>
  );
}
