import { useMemo, useState } from "react";
import type { ReminderInfo, RepeatRule, FollowUpConfig, LinkedItem, ContextTriggerConfig } from "../../notes/types";
import { nextOccurrence, describeRepeat, followUpOf, repeatRuleOf, scheduleKindOf, WEEKDAYS, WEEKENDS } from "../reminders";
import { COOLDOWNS, DEFAULT_COOLDOWN_MIN } from "../contextPrompts";
import { readQuick, morningTime, inMinutes } from "../quickReminder";
import { FormSheet, Group, Row, FieldRow, MenuRow, Strip, Note, ErrorLine, SwitchRow } from "../../shared/FormSheet";
import { Clock, Calendar, Tag, Link2, Forward } from "../../shared/icons";
import { BellGlyph, RepeatGlyph, WarningGlyph } from "../../shared/glyphs";
import { todayISO } from "../grouping";
import { addDays, fmtTime } from "../../schedule/calendar";
import { pressable } from "../../shared/pressable";
import { actionLabelFor } from "../reminderHistory";
import LinkedItemSheet, { type LinkCandidate } from "./LinkedItemSheet";

// THE REMINDER FORM (the reminders rebuild, push E to Dave's interactive
// preview, on the app's own rows). What would you like to remember; when
// should it appear (at a date and time, when I open the area, after I
// complete the task, or unscheduled); for a timed one the day, the time,
// two shortcuts, the rhythm; then one green line saying what was just set;
// then Area, Linked Action and Follow-up behind a disclosure. The words are
// read as they are typed and shown as chips. Save is never dead: whatever
// is missing says so at its field. Pause, Skip, Export and Delete live on
// the details sheet, not here.

type RepeatKey = "once" | "daily" | "weekdaysOnly" | "weekends" | "weekly" | "monthly" | "every3" | "after3";
const REPEAT_OPTIONS: { value: RepeatKey; label: string; rule: RepeatRule }[] = [
  { value: "once", label: "Never", rule: { kind: "once" } },
  { value: "daily", label: "Daily", rule: { kind: "daily" } },
  { value: "weekdaysOnly", label: "Weekdays", rule: { kind: "weekdays", days: WEEKDAYS } },
  { value: "weekends", label: "Weekends", rule: { kind: "weekdays", days: WEEKENDS } },
  { value: "weekly", label: "Weekly", rule: { kind: "weekly" } },
  { value: "monthly", label: "Monthly", rule: { kind: "monthly" } },
  { value: "every3", label: "Every 3 Days", rule: { kind: "everyNDays", n: 3 } },
  { value: "after3", label: "3 Days After Completion", rule: { kind: "afterCompletion", days: 3 } },
];
function keyOf(rule: RepeatRule): RepeatKey {
  const hit = REPEAT_OPTIONS.find((o) => JSON.stringify(o.rule) === JSON.stringify(rule));
  return hit?.value ?? (rule.kind === "weekdays" ? "weekdaysOnly" : rule.kind === "everyNDays" ? "every3" : rule.kind === "afterCompletion" ? "after3" : "daily");
}

type WhenKey = "time" | "area" | "task" | "none";
const WHEN_OPTIONS: { value: WhenKey; label: string }[] = [
  { value: "time", label: "At a Date and Time" },
  { value: "area", label: "When I Open the Area" },
  { value: "task", label: "After I Complete the Task" },
  { value: "none", label: "Unscheduled" },
];

type FollowKey = "off" | "15" | "60";
const FOLLOW_OPTIONS: { value: FollowKey; label: string }[] = [
  { value: "off", label: "None" },
  { value: "15", label: "Once After 15 Minutes" },
  { value: "60", label: "Once After 1 Hour" },
];
function followKeyOf(fu: FollowUpConfig | null): FollowKey {
  if (!fu) return "off";
  return fu.delayMinutes >= 60 ? "60" : "15";
}

// The day and time as a person says them.
export function whenLabel(date: string, time: string, today: string): string {
  const day = date === today ? "Today" : date === addDays(today, 1) ? "Tomorrow" : (() => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  })();
  const t = fmtTime(time);
  return `${day}, ${t.time} ${t.ap}`;
}
const clock = (hhmm: string) => { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; };
const localZone = (): string => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "local"; } catch { return "local"; } };

export default function ReminderSheet({
  initial,
  mode = "new",
  categories = [],
  onSave,
  onCancel,
  now = Date.now(),
  onOpenLinked,
  linkCandidates = [],
  today: todayProp,
  nowHHMM,
  defaultFollowUp = false,
}: {
  initial?: { text: string; reminder: ReminderInfo; due?: string | null; category?: string };
  mode?: "new" | "edit";
  /** The areas this reminder can be filed to. */
  categories?: { id: string; name: string; color: string }[];
  onSave: (text: string, r: ReminderInfo, extra: { due: string | null; category: string; receipt: string }) => void;
  onCancel: () => void;
  now?: number;
  onOpenLinked?: (link: LinkedItem) => void;
  linkCandidates?: LinkCandidate[];
  today?: string;
  nowHHMM?: string;
  /** The Reminder Settings default: a new reminder asks once an hour on. */
  defaultFollowUp?: boolean;
}) {
  const today = todayProp ?? todayISO();
  const nowClock = nowHHMM ?? new Date(now).toTimeString().slice(0, 5);
  const init = initial?.reminder;
  const initWhen: WhenKey = init
    ? (init.contextTrigger?.targetId && scheduleKindOf(init) === "unscheduled" ? (init.contextTrigger.kind === "onOpenArea" ? "area" : "task") : scheduleKindOf(init) === "unscheduled" ? "none" : "time")
    : "time";
  const [text, setText] = useState(initial?.text ?? "");
  const [when, setWhen] = useState<WhenKey>(initWhen);
  const [time, setTime] = useState<string>(init?.time && scheduleKindOf(init) === "timed" ? init.time : "");
  const [due, setDue] = useState(initial?.due ?? init?.startDate ?? (mode === "new" ? today : ""));
  const [category, setCategory] = useState(initial?.category ?? "");
  const [repeat, setRepeat] = useState<RepeatRule>(init ? repeatRuleOf(init) : { kind: "once" });
  const [repeatTouched, setRepeatTouched] = useState(mode === "edit");
  const initFollow = init ? followUpOf(init) : (defaultFollowUp ? { delayMinutes: 60, maxCount: 1, stopAt: null } : null);
  const [follow, setFollow] = useState<FollowKey>(followKeyOf(initFollow));
  const [fixedZone, setFixedZone] = useState(!!init?.tz && init.tz !== "local");
  const [link, setLink] = useState<LinkedItem | null>(init?.linkedItem ?? null);
  const [pickingLink, setPickingLink] = useState(false);
  const [cooldown, setCooldown] = useState(init?.contextTrigger?.cooldownMinutes ?? DEFAULT_COOLDOWN_MIN);
  const [moreOpen, setMoreOpen] = useState(mode === "edit");
  const [errName, setErrName] = useState(false);
  const [errTime, setErrTime] = useState(false);
  const [errArea, setErrArea] = useState(false);
  const [errLink, setErrLink] = useState(false);
  const [saving, setSaving] = useState(false);
  const [readOff, setReadOff] = useState(false);
  const tzName = localZone();
  const zoneShort = ((): string => {
    try { return new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(new Date(now)).find((p) => p.type === "timeZoneName")?.value ?? tzName; } catch { return tzName; }
  })();

  // THE QUICK READ: what the words name, as chips.
  const read = useMemo(() => (mode === "new" && !readOff ? readQuick(text, today) : null), [text, today, mode, readOff]);
  const readActive = !!read && read.matched.length > 0 && when === "time";
  const effDay = readActive && read!.day ? read!.day : due;
  const effTime = readActive && read!.time ? read!.time : time;
  const effRepeat: RepeatRule = readActive && read!.repeat ? read!.repeat : readActive && read!.day && !repeatTouched ? { kind: "once" } : repeat;
  const effText = readActive ? read!.title : text;
  const areaName = categories.find((c) => c.id === category)?.name ?? "";

  const trigger = (): ContextTriggerConfig | undefined => {
    if (when === "area") return { kind: "onOpenArea", targetId: category || null, cooldownMinutes: cooldown, lastShownAt: init?.contextTrigger?.lastShownAt ?? null };
    if (when === "task") return { kind: "afterCompleteTask", targetId: link?.type === "task" ? link.id : null, cooldownMinutes: cooldown, lastShownAt: init?.contextTrigger?.lastShownAt ?? null };
    return undefined;
  };
  const draft = (): ReminderInfo => {
    const rule = effRepeat;
    const fu: FollowUpConfig | null = follow === "off" ? null : { delayMinutes: Number(follow), maxCount: 1, stopAt: null };
    const timed = when === "time";
    return {
      ...init,
      time: (timed && effTime) || init?.time || "08:00",
      days: timed && rule.kind === "weekdays" ? rule.days : undefined,
      onMiss: fu ? "nag" : "let_go",
      scheduleKind: timed ? "timed" : "unscheduled",
      startDate: timed ? (effDay || today) : undefined,
      repeat: timed ? rule : { kind: "once" },
      followUp: fu,
      tz: fixedZone ? tzName : "local",
      linkedItem: link ?? undefined,
      contextTrigger: trigger(),
    };
  };
  const next = when === "time" && effTime ? nextOccurrence(draft(), today, nowClock) : null;

  const save = () => {
    const name = effText.trim();
    const missingName = !name;
    const missingTime = when === "time" && !effTime;
    const missingArea = when === "area" && !category;
    const missingLink = when === "task" && link?.type !== "task";
    setErrName(missingName); setErrTime(missingTime); setErrArea(missingArea); setErrLink(missingLink);
    if (missingArea || missingLink) setMoreOpen(true);
    if (missingName || missingTime || missingArea || missingLink) return;
    if (saving) return;
    setSaving(true);
    const r = draft();
    const receipt = when === "time"
      ? (next ? "Reminder Set · " + whenLabel(next.date, next.time, today) : "Reminder Set")
      : when === "area" ? "Reminder Set · When you open " + areaName
        : when === "task" ? "Reminder Set · After " + (link?.label ?? "the task")
          : "Reminder Saved · Unscheduled";
    onSave(name, r, { due: when === "time" && effRepeat.kind === "once" ? (effDay || today) : null, category, receipt });
  };

  const pickDay = (day: string) => { setDue(day); if (day && !repeatTouched) setRepeat({ kind: "once" }); };
  const pick = (day: string, hhmm: string) => { setWhen("time"); pickDay(day); setTime(hhmm); setErrTime(false); if (readActive) setReadOff(true); };
  const chip = (on: boolean, label: string, onPick: () => void, key: string) => (
    <div key={key} {...pressable(onPick)} className={"chip" + (on ? " active" : "")} aria-pressed={on}>{label}</div>
  );
  const h1 = inMinutes(now, 60);
  const tomorrowMorning = { day: addDays(today, 1), time: morningTime() };
  const isPick = (p: { day: string; time: string }) => when === "time" && effDay === p.day && effTime === p.time;

  // THE GREEN LINE: what was just set, in words.
  const summary = when === "time"
    ? (effTime
      ? { head: `${effRepeat.kind === "once" ? "One Time" : describeRepeat(effRepeat)} · ${clock(effTime)}`, line: next ? "Next " + whenLabel(next.date, next.time, today) : `Starts ${effDay === today || !effDay ? "Today" : effDay === addDays(today, 1) ? "Tomorrow" : effDay}` }
      : null)
    : when === "none" ? { head: "Unscheduled", line: "Sits in Upcoming · No timed alert" }
      : when === "area" ? { head: areaName ? `When You Open ${areaName}` : "When You Open the Area", line: "An in-app prompt · You can always continue" }
        : { head: link?.type === "task" ? `After ${link.label ?? "the Task"}` : "After You Complete the Task", line: "An in-app prompt · You can always continue" };

  return (
    <FormSheet title={mode === "edit" ? "Edit Reminder" : "New Reminder"} onCancel={onCancel} onSave={save} saveLabel={saving ? "Saving" : "Save"}>
      <Group label="What Would You Like to Remember?">
        <FieldRow tone="orange" glyph={<BellGlyph />} value={text} onChange={(v) => { setText(v); setErrName(false); setReadOff(false); }} placeholder="e.g. Call Alberto"
          ariaLabel="Reminder" error={errName} right={false} onEnter={save} />
        {readActive && (
          <Strip>
            <span className="rem-read-k">Read from your words</span>
            {read!.day && chip(true, effDay === today ? "Today" : effDay === addDays(today, 1) ? "Tomorrow" : effDay, () => setReadOff(true), "rd")}
            {read!.time && chip(true, clock(read!.time), () => setReadOff(true), "rt")}
            {read!.repeat && chip(true, describeRepeat(read!.repeat), () => setReadOff(true), "rr")}
          </Strip>
        )}
      </Group>
      <ErrorLine text={errName ? "Enter something to remember." : null} />

      <Group label="When Should It Appear?">
        <MenuRow tone="purple" glyph={<Clock className="ic" />} label="Appears" value={when} word={WHEN_OPTIONS.find((o) => o.value === when)?.label ?? ""} ariaLabel="When should it appear"
          options={WHEN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onPick={(v) => { setWhen(v as WhenKey); setErrTime(false); setErrArea(false); setErrLink(false); }} />
        {when === "time" && (
          <>
            <FieldRow tone="indigo" glyph={<Calendar className="ic" />} label="Day" type="date" value={effDay} onChange={(v) => { pickDay(v); if (readActive) setReadOff(true); }} ariaLabel="Start day" />
            <FieldRow tone="blue" glyph={<Clock className="ic" />} label="Time" type="time" value={effTime} onChange={(v) => { setTime(v); setErrTime(false); if (readActive) setReadOff(true); }} ariaLabel="Time" error={errTime} />
            <Strip>
              {chip(isPick(h1), "In 1 Hour", () => pick(h1.day, h1.time), "h1")}
              {chip(isPick(tomorrowMorning), "Tomorrow Morning", () => pick(tomorrowMorning.day, tomorrowMorning.time), "tm")}
            </Strip>
            <ErrorLine text={errTime ? "Pick a time, or choose Unscheduled." : null} />
            <MenuRow tone="sky" glyph={<RepeatGlyph />} label="Repeat" value={keyOf(effRepeat)} word={REPEAT_OPTIONS.find((o) => o.value === keyOf(effRepeat))?.label ?? describeRepeat(effRepeat)} ariaLabel="Repeat"
              options={REPEAT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onPick={(v) => { const o = REPEAT_OPTIONS.find((x) => x.value === v); if (o) setRepeat(o.rule); setRepeatTouched(true); if (readActive) setReadOff(true); }} />
          </>
        )}
        {(when === "area" || when === "task") && (
          <MenuRow tone="purple" glyph={<WarningGlyph />} label="At Most Every" value={String(cooldown)} ariaLabel="Prompt cooldown"
            word={COOLDOWNS.find((c) => c.minutes === cooldown)?.label ?? cooldown + " Minutes"}
            options={COOLDOWNS.map((c) => ({ value: String(c.minutes), label: c.label }))}
            onPick={(v) => setCooldown(Number(v))} />
        )}
        {summary && (
          <div className="rem-summary" role="status">
            <div className="rem-summary-head">{summary.head}</div>
            <div className="rem-summary-line">{summary.line}</div>
          </div>
        )}
      </Group>
      <ErrorLine text={errArea ? "Choose an area below." : errLink ? "Link a task below." : null} />

      <details className="exp-more rem-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
        <summary>Area, Linked Action and Follow-up</summary>
        {categories.length > 0 && (
          <Group label="Area">
            <MenuRow tone="blue" glyph={<Tag className="ic" />} label="Area" value={category} ariaLabel="Area"
              word={areaName || "None"} off={category === ""}
              options={[{ value: "", label: "None" }, ...categories.map((c) => ({ value: c.id, label: c.name, dot: c.color }))]}
              onPick={(v) => { setCategory(v); setErrArea(false); }} />
          </Group>
        )}
        <Group label="Linked Action">
          <Row tone="sky" glyph={<Link2 className="ic" />} label="Linked Item" meta={link ? (link.label ?? "Linked") : "None"} onClick={() => setPickingLink(true)} chev />
          {mode === "edit" && link && onOpenLinked && (
            <Row tone="red" glyph={<Forward className="ic" />} label={actionLabelFor(link)} meta={link.label ?? ""} onClick={() => onOpenLinked(link)} chev />
          )}
          <Note>What this reminder is about · Opening it never marks the reminder done</Note>
        </Group>
        <Group label="Follow-up">
          <MenuRow tone="sand" glyph={<WarningGlyph />} label="Follow-up" value={follow} ariaLabel="Follow-up"
            word={FOLLOW_OPTIONS.find((o) => o.value === follow)?.label ?? "None"} off={follow === "off"}
            options={FOLLOW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onPick={(v) => setFollow(v as FollowKey)} />
          {when === "time" && (
            <SwitchRow tone="indigo" glyph={<Clock className="ic" />} label="Pin to This Time Zone" meta={zoneShort} on={fixedZone} onToggle={() => setFixedZone((v) => !v)} ariaLabel="Pin to this time zone" />
          )}
        </Group>
      </details>

      {pickingLink && (
        <LinkedItemSheet candidates={linkCandidates} current={link} onPick={(l) => { setLink(l); setErrLink(false); setPickingLink(false); }} onCancel={() => setPickingLink(false)} />
      )}
    </FormSheet>
  );
}
