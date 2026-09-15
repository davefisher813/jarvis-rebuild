import { useMemo, useState } from "react";
import type { ReminderInfo, RepeatRule, FollowUpConfig } from "../../notes/types";
import { repetitionsLine } from "../automaticity";
import { nextOccurrence, describeRepeat, followUpOf, repeatRuleOf, scheduleKindOf, WEEKDAYS, WEEKENDS } from "../reminders";
import { readQuick, morningTime, inMinutes } from "../quickReminder";
import { FormSheet, Group, Row, FieldRow, MenuRow, Strip, Note, DeleteRow, ErrorLine, SwitchRow } from "../../shared/FormSheet";
import { Clock, CalendarPlus, Calendar, Tag, CircleSlash, Hourglass } from "../../shared/icons";
import { BellGlyph, RepeatGlyph, WarningGlyph } from "../../shared/glyphs";
import { todayISO } from "../grouping";
import { addDays, fmtTime } from "../../schedule/calendar";
import { pressable } from "../../shared/pressable";

// THE REMINDER SHEET, REBUILT (the reminders rebuild, 2026-09-15, Dave's
// brief sections 2 and 3).
//
// Quick creation is three things: what to remember, when, Save. The words
// are read as they are typed (tasks/quickReminder.ts, the same deterministic
// resolvers Smart Paste uses) and what they name becomes chips the person
// can change; nothing is guessed for a word that cannot be read. When is
// four shortcuts and a real date and time. Everything else (Repeat, Area,
// Follow-up, time zone) waits behind one disclosure, collapsed.
//
// Timed or unscheduled is said explicitly (scheduleKind), never inferred
// from which fields happen to be filled: a timed reminder shows its start
// day, time, repeat and the computed next occurrence together; an
// unscheduled one shows the word Unscheduled and its one-line explainer and
// nothing shaped like a schedule. Save is never a dead button: whatever is
// missing says so at its field.
//
// "Where" is Area, and it is the same area record every task and event
// uses. "If You Miss It" is Follow-up: not responding is not failure.
// Delete lives in More Actions at the foot, alone, never beside Save.

const QUICK_TIMES = [
  { v: "07:00", label: "7 AM" }, { v: "08:00", label: "8 AM" },
  { v: "12:00", label: "12 PM" }, { v: "18:00", label: "6 PM" },
  { v: "21:00", label: "9 PM" },
];

type RepeatKey = "once" | "daily" | "weekdaysOnly" | "weekends" | "weekly" | "monthly" | "every3" | "after3";
const REPEAT_OPTIONS: { value: RepeatKey; label: string; rule: RepeatRule }[] = [
  { value: "once", label: "Just Once", rule: { kind: "once" } },
  { value: "daily", label: "Every Day", rule: { kind: "daily" } },
  { value: "weekdaysOnly", label: "Weekdays", rule: { kind: "weekdays", days: WEEKDAYS } },
  { value: "weekends", label: "Weekends", rule: { kind: "weekdays", days: WEEKENDS } },
  { value: "weekly", label: "Every Week", rule: { kind: "weekly" } },
  { value: "monthly", label: "Every Month", rule: { kind: "monthly" } },
  { value: "every3", label: "Every 3 Days", rule: { kind: "everyNDays", n: 3 } },
  { value: "after3", label: "3 Days After Completion", rule: { kind: "afterCompletion", days: 3 } },
];
function keyOf(rule: RepeatRule): RepeatKey {
  const hit = REPEAT_OPTIONS.find((o) => JSON.stringify(o.rule) === JSON.stringify(rule));
  return hit?.value ?? (rule.kind === "weekdays" ? "weekdaysOnly" : rule.kind === "everyNDays" ? "every3" : rule.kind === "afterCompletion" ? "after3" : "daily");
}

type FollowKey = "off" | "15" | "30" | "60";
const FOLLOW_OPTIONS: { value: FollowKey; label: string }[] = [
  { value: "off", label: "None" },
  { value: "15", label: "Ask Again in 15m" },
  { value: "30", label: "Ask Again in 30m" },
  { value: "60", label: "Ask Again in 1h" },
];

// The day and time as a person says them.
export function whenLabel(date: string, time: string, today: string): string {
  const day = date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : (() => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  })();
  const t = fmtTime(time);
  return `${day}, ${t.time} ${t.ap}`;
}

const localZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "local"; } catch { return "local"; } };

export default function ReminderSheet({
  initial,
  mode = "new",
  categories = [],
  onSave,
  onDelete,
  onPause,
  onAddToCalendar,
  onCancel,
  now = Date.now(),
}: {
  initial?: { text: string; reminder: ReminderInfo; due?: string | null; category?: string };
  mode?: "new" | "edit";
  /** The areas this reminder can be filed to; with none the row does not render. */
  categories?: { id: string; name: string; color: string }[];
  onSave: (text: string, r: ReminderInfo, extra: { due: string | null; category: string; receipt: string }) => void;
  onDelete?: () => void;
  /** Pause or resume the series, one tap from the sheet. */
  onPause?: (paused: boolean) => void;
  onAddToCalendar?: () => void;
  onCancel: () => void;
  now?: number;
}) {
  const today = todayISO();
  const init = initial?.reminder;
  const [text, setText] = useState(initial?.text ?? "");
  const [kind, setKind] = useState<"timed" | "unscheduled">(init ? scheduleKindOf(init) : "timed");
  const [time, setTime] = useState<string>(init?.time ?? "");
  const [due, setDue] = useState(initial?.due ?? init?.startDate ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [repeat, setRepeat] = useState<RepeatRule>(init ? repeatRuleOf(init) : (initial?.due ? { kind: "once" } : { kind: "daily" }));
  // A day picked before any rhythm was chosen means Just Once, the way "on
  // Thursday" does; a rhythm the person chose is never overwritten.
  const [repeatTouched, setRepeatTouched] = useState(mode === "edit");
  const initFollow = init ? followUpOf(init) : null;
  const [follow, setFollow] = useState<FollowKey>(initFollow ? (String(initFollow.delayMinutes) as FollowKey) : "off");
  const [followMax, setFollowMax] = useState(initFollow?.maxCount ?? 1);
  const [followStop, setFollowStop] = useState(initFollow?.stopAt ?? "");
  const [fixedZone, setFixedZone] = useState(!!init?.tz && init.tz !== "local");
  const [moreOpen, setMoreOpen] = useState(false);
  const [errName, setErrName] = useState(false);
  const [errTime, setErrTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readOff, setReadOff] = useState(false);
  const autoLine = repetitionsLine(init?.doneCount);
  const tzName = localZone();
  const zoneShort = ((): string => {
    try { return new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(new Date(now)).find((p) => p.type === "timeZoneName")?.value ?? tzName; } catch { return tzName; }
  })();

  // THE QUICK READ: what the words name, as chips. Applied while the person
  // types a new reminder; a chip cleared with a tap puts that word back.
  const read = useMemo(() => (mode === "new" && !readOff ? readQuick(text, today) : null), [text, today, mode, readOff]);
  const readActive = !!read && read.matched.length > 0;
  const effDay = readActive && read!.day ? read!.day : due;
  const effTime = readActive && read!.time ? read!.time : time;
  // A day read from the words with no rhythm beside it means once, the
  // same as a day picked by hand before any rhythm was chosen.
  const effRepeat: RepeatRule = readActive && read!.repeat ? read!.repeat : readActive && read!.day && !repeatTouched ? { kind: "once" } : repeat;
  const effText = readActive ? read!.title : text;

  const draft = (): ReminderInfo => {
    const rule = effRepeat;
    const fu: FollowUpConfig | null = follow === "off" ? null : { delayMinutes: Number(follow), maxCount: followMax, stopAt: followStop || null };
    return {
      ...init,
      time: effTime || init?.time || "08:00",
      days: rule.kind === "weekdays" ? rule.days : undefined,
      onMiss: fu ? "nag" : "let_go",
      scheduleKind: kind,
      startDate: kind === "timed" ? (effDay || today) : undefined,
      repeat: rule,
      followUp: fu,
      tz: fixedZone ? tzName : "local",
    };
  };
  const next = kind === "timed" && effTime ? nextOccurrence(draft(), today, new Date(now).toTimeString().slice(0, 5)) : null;

  const save = () => {
    const name = effText.trim();
    const missingName = !name;
    const missingTime = kind === "timed" && !effTime;
    setErrName(missingName);
    setErrTime(missingTime);
    if (missingName || missingTime) return;
    if (saving) return;
    setSaving(true);
    const r = draft();
    const receipt = kind === "unscheduled" ? "Reminder Saved · Unscheduled" : next ? "Reminder Set · " + whenLabel(next.date, next.time, today) : "Reminder Set";
    onSave(name, r, { due: kind === "timed" && effRepeat.kind === "once" ? (effDay || today) : null, category, receipt });
  };

  const pickDay = (day: string) => { setDue(day); if (day && !repeatTouched) setRepeat({ kind: "once" }); };
  const pick = (day: string, hhmm: string) => { setKind("timed"); pickDay(day); setTime(hhmm); setErrTime(false); if (readActive) setReadOff(true); };
  const chooseDateTime = () => {
    setKind("timed");
    if (readActive) setReadOff(true);
    // The day field is on screen once the kind is timed; the next frame it
    // takes the focus so the picker is one tap, not two.
    requestAnimationFrame(() => { const el = document.querySelector<HTMLInputElement>("input[aria-label=\"Start day\"]"); el?.focus(); });
  };
  const chip = (on: boolean, label: string, onPick: () => void, key: string) => (
    <div key={key} {...pressable(onPick)} className={"chip" + (on ? " active" : "")} aria-pressed={on}>{label}</div>
  );
  const m15 = inMinutes(now, 15);
  const h1 = inMinutes(now, 60);
  const tomorrowMorning = { day: addDays(today, 1), time: morningTime() };
  const isPick = (p: { day: string; time: string }) => kind === "timed" && effDay === p.day && effTime === p.time;

  return (
    <FormSheet title={mode === "edit" ? "Reminder" : "New Reminder"} onCancel={onCancel} onSave={save} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="What to Remember">
        <FieldRow tone="orange" glyph={<BellGlyph />} value={text} onChange={(v) => { setText(v); setErrName(false); setReadOff(false); }} placeholder="Meds at 8 · every day"
          ariaLabel="Reminder" error={errName} right={false} onEnter={save} />
        {readActive && (
          <Strip>
            <span className="rem-read-k">Read from your words</span>
            {read!.day && chip(true, effDay === today ? "Today" : effDay === addDays(today, 1) ? "Tomorrow" : effDay, () => setReadOff(true), "rd")}
            {read!.time && chip(true, fmtTime(read!.time).time + " " + fmtTime(read!.time).ap, () => setReadOff(true), "rt")}
            {read!.repeat && chip(true, describeRepeat(read!.repeat), () => setReadOff(true), "rr")}
          </Strip>
        )}
      </Group>
      <ErrorLine text={errName ? "Add a name." : null} />

      <Group label="When">
        <Strip>
          {chip(isPick(m15), "In 15 Minutes", () => pick(m15.day, m15.time), "m15")}
          {chip(isPick(h1), "In 1 Hour", () => pick(h1.day, h1.time), "h1")}
          {chip(isPick(tomorrowMorning), "Tomorrow Morning", () => pick(tomorrowMorning.day, tomorrowMorning.time), "tm")}
          {chip(false, "Choose Date & Time", chooseDateTime, "dt")}
          {chip(kind === "unscheduled", "Unscheduled", () => { setKind("unscheduled"); setErrTime(false); }, "un")}
        </Strip>
        {kind === "timed" ? (
          <>
            <FieldRow tone="indigo" glyph={<Calendar className="ic" />} label="Start Day" type="date" value={effDay} onChange={(v) => { pickDay(v); if (readActive) setReadOff(true); }} ariaLabel="Start day" />
            <FieldRow tone="blue" glyph={<Clock className="ic" />} label="Time" type="time" value={effTime} onChange={(v) => { setTime(v); setErrTime(false); if (readActive) setReadOff(true); }} ariaLabel="Time" error={errTime} />
            <Strip>
              {QUICK_TIMES.map((q) => chip(effTime === q.v, q.label, () => { setTime(q.v); setErrTime(false); if (readActive) setReadOff(true); }, q.v))}
            </Strip>
            <ErrorLine text={errTime ? "Pick a time, or mark this Unscheduled." : null} />
            <MenuRow tone="sky" glyph={<RepeatGlyph />} label="Repeat" value={keyOf(effRepeat)} word={describeRepeat(effRepeat)} ariaLabel="Repeat"
              options={REPEAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onPick={(v) => { const o = REPEAT_OPTIONS.find((x) => x.value === v); if (o) setRepeat(o.rule); setRepeatTouched(true); if (readActive) setReadOff(true); }} />
            <Row tone="green" glyph={<Clock className="ic" />} label="Next" meta={next ? whenLabel(next.date, next.time, today) : effTime ? "Nothing ahead on this schedule" : "Pick a time"} />
          </>
        ) : (
          <>
            <Row tone="grey" glyph={<CircleSlash className="ic" />} label="Unscheduled" meta="No timed alert" />
            <Note>Appears in Reminders until you clear it or give it a time.</Note>
          </>
        )}
      </Group>

      <details className="exp-more rem-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
        <summary>More Options</summary>
        {categories.length > 0 && (
          <Group label="Area">
            <MenuRow tone="blue" glyph={<Tag className="ic" />} label="Area" value={category} ariaLabel="Area"
              word={categories.find((c) => c.id === category)?.name ?? "None"} off={category === ""}
              options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c.id, label: c.name, dot: c.color }))]}
              onPick={setCategory} />
          </Group>
        )}
        {kind === "timed" && (
          <Group label="Follow-up">
            <MenuRow tone="sand" glyph={<WarningGlyph />} label="Follow-up" value={follow} ariaLabel="Follow-up"
              word={FOLLOW_OPTIONS.find((o) => o.value === follow)?.label ?? "Off"} off={follow === "off"}
              options={FOLLOW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onPick={(v) => setFollow(v as FollowKey)} />
            {follow !== "off" && (
              <>
                <MenuRow tone="sand" glyph={<RepeatGlyph />} label="At Most" value={String(followMax)} ariaLabel="Follow-ups at most"
                  word={followMax === 1 ? "Once" : followMax + " Times"}
                  options={[1, 2, 3].map((n) => ({ value: String(n), label: n === 1 ? "Once" : n + " Times" }))}
                  onPick={(v) => setFollowMax(Number(v))} />
                <FieldRow tone="sand" glyph={<Clock className="ic" />} label="Stop After" type="time" value={followStop} onChange={setFollowStop} ariaLabel="Stop follow-ups after" />
                <Note>One ask per occurrence unless you say otherwise. Never after the stop time.</Note>
              </>
            )}
          </Group>
        )}
        {kind === "timed" && (
          <Group label="Time Zone">
            <SwitchRow tone="indigo" glyph={<Clock className="ic" />} label="Pin to This Time Zone" meta={zoneShort} on={fixedZone} onToggle={() => setFixedZone((v) => !v)} ariaLabel="Pin to this time zone" />
            <Note>{fixedZone ? "Pinned to this zone: the alert keeps its moment when you travel." : "Local clock: the alert follows the clock wherever you are."}</Note>
          </Group>
        )}
      </details>

      {autoLine && (
        <Group label="So Far">
          <Strip plain>
            <div className="auto-line">
              <div className="auto-text">{autoLine}</div>
            </div>
          </Strip>
        </Group>
      )}

      {mode === "edit" && (onPause || onAddToCalendar || onDelete) && (
        <>
          {onPause && (
            <Group label="Series">
              <Row tone="grey" glyph={<Hourglass className="ic" />} label={init?.paused ? "Resume" : "Pause"} meta={init?.paused ? "Paused · No alerts until you resume" : "Stops alerts until you resume"} onClick={() => onPause(!init?.paused)} chev />
            </Group>
          )}
          <details className="exp-more rem-more">
            <summary>More Actions</summary>
            <Group className="xs-actions">
              {onAddToCalendar && <Row tone="red" glyph={<CalendarPlus className="ic" />} label="Export to Calendar" onClick={onAddToCalendar} chev />}
              {onDelete && <DeleteRow label="Delete Reminder" onClick={onDelete} />}
            </Group>
            {onAddToCalendar && <Note>A one-time copy of this reminder as a calendar file.</Note>}
          </details>
        </>
      )}
    </FormSheet>
  );
}
