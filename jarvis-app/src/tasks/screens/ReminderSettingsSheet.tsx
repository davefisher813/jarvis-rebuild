import { useState } from "react";
import { FormSheet, Group, SwitchRow, FieldRow, MenuRow, Row, Note } from "../../shared/FormSheet";
import { Clock, Bell, ShieldAlert } from "../../shared/icons";
import { WarningGlyph } from "../../shared/glyphs";
import { fmtTime } from "../../schedule/calendar";
import { morningTime, setMorningTime } from "../quickReminder";
import { DEFAULT_QUIET_FROM, DEFAULT_QUIET_TO } from "../reminders";

// REMINDER SETTINGS (the reminders rebuild push E, Dave's interactive
// preview: "Helpful. On your terms."). Quiet hours, the default follow-up,
// private alerts and the morning time, then how alerts reach this phone
// and a test send. Saved together from the bar.

export interface ReminderPrefs {
  quietHours: boolean;
  quietFrom: string;
  quietTo: string;
  defaultFollowUp: boolean;
  privateAlerts: boolean;
}
export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { quietHours: false, quietFrom: DEFAULT_QUIET_FROM, quietTo: DEFAULT_QUIET_TO, defaultFollowUp: false, privateAlerts: false };

const clock = (hhmm: string) => { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; };

export default function ReminderSettingsSheet({ initial, native, permission, testing = false, onSave, onTest, onCancel }: {
  initial: ReminderPrefs;
  native: boolean;
  permission: "granted" | "denied" | "prompt" | "unsupported";
  testing?: boolean;
  onSave: (prefs: ReminderPrefs, morning: string) => void;
  onTest?: () => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<ReminderPrefs>(initial);
  const [morning, setMorning] = useState(morningTime());
  const patch = (x: Partial<ReminderPrefs>) => setP((prev) => ({ ...prev, ...x }));
  const save = () => { setMorningTime(morning); onSave(p, morning); };
  const denied = permission === "denied";
  return (
    <FormSheet title="Reminder Settings" onCancel={onCancel} onSave={save} dirty={JSON.stringify(p) !== JSON.stringify(initial) || morning !== morningTime()}>
      <Group label="Quiet Hours">
        {/* Off, the row says nothing under its name: an "Off" line only
            repeated what the switch beside it already shows (§AK R1). */}
        <SwitchRow tone="indigo" glyph={<Clock className="ic" />} label="Quiet Hours" meta={p.quietHours ? `${clock(p.quietFrom)} to ${clock(p.quietTo)}` : undefined} on={p.quietHours} onToggle={() => patch({ quietHours: !p.quietHours })} ariaLabel="Quiet hours" />
        {p.quietHours && (
          <>
            <FieldRow tone="indigo" glyph={<Clock className="ic" />} label="From" type="time" value={p.quietFrom} onChange={(v) => { if (/^\d{2}:\d{2}$/.test(v)) patch({ quietFrom: v }); }} ariaLabel="Quiet from" />
            <FieldRow tone="indigo" glyph={<Clock className="ic" />} label="To" type="time" value={p.quietTo} onChange={(v) => { if (/^\d{2}:\d{2}$/.test(v)) patch({ quietTo: v }); }} ariaLabel="Quiet to" />
          </>
        )}
        {/* 2026-10-04: the note promised follow-ups "wait" and in-app prompts
            too. The scheduler skips a follow-up that would land in the window
            (notifications.ts), nothing defers it, and no in-app prompt reads
            this setting. It says only what happens. */}
        <Note>A Follow-up That Would Land in Quiet Hours Is Skipped · A Reminder's Own Alert Still Rings</Note>
      </Group>
      <Group label="Follow-up">
        <SwitchRow tone="sand" glyph={<WarningGlyph />} label="Default Follow-up" meta="Once After 1 Hour for New Reminders" on={p.defaultFollowUp} onToggle={() => patch({ defaultFollowUp: !p.defaultFollowUp })} ariaLabel="Default follow-up" />
      </Group>
      <Group label="Privacy">
        <SwitchRow tone="green" glyph={<ShieldAlert className="ic" />} label="Hide Sensitive Details" meta="Health Reminders Say Only That There Is One" on={p.privateAlerts} onToggle={() => patch({ privateAlerts: !p.privateAlerts })} ariaLabel="Hide sensitive details" />
      </Group>
      <Group label="Morning">
        <MenuRow tone="orange" glyph={<Bell className="ic" />} label="Tomorrow Morning Means" value={morning} word={clock(morning)} ariaLabel="Morning time"
          options={["06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00"].map((v) => ({ value: v, label: clock(v) }))}
          onPick={setMorning} />
      </Group>
      <Group label="Alerts on This Phone">
        {native && onTest && !denied && <Row tone="red" glyph={<Bell className="ic" />} label={testing ? "Sending" : "Send a Test Reminder"} meta="Arrives in 10 Seconds" onClick={testing ? undefined : onTest} chev />}
        <Note>
          {!native
            ? "Alerts Need the Phone App · On the Web Reminders Show Inside JARVIS Only"
            : denied
              ? "Notifications Are Off for JARVIS in iOS Settings · Turn Them on There and Nothing Here Has to Change"
              : permission === "prompt"
                ? "iOS Will Ask to Allow Notifications the First Time a Reminder Is Set"
                : "Reminders Arrive on This Phone"}
        </Note>
      </Group>
    </FormSheet>
  );
}
