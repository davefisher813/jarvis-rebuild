import { useState } from "react";
import { FormSheet, Group, SwitchRow, FieldRow, MenuRow, Row, Note } from "../../shared/FormSheet";
import { Clock, Bell, ShieldAlert } from "../../shared/icons";
import { WarningGlyph } from "../../shared/glyphs";
import { fmtTime } from "../../schedule/calendar";
import { morningTime, setMorningTime } from "../quickReminder";

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
export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { quietHours: false, quietFrom: "21:00", quietTo: "08:00", defaultFollowUp: false, privateAlerts: false };

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
        <Note>Follow-ups and in-app prompts wait until quiet hours end · A reminder's own alert still rings</Note>
      </Group>
      <Group label="Follow-up">
        <SwitchRow tone="sand" glyph={<WarningGlyph />} label="Default Follow-up" meta="Once After 1 Hour for new reminders" on={p.defaultFollowUp} onToggle={() => patch({ defaultFollowUp: !p.defaultFollowUp })} ariaLabel="Default follow-up" />
      </Group>
      <Group label="Privacy">
        <SwitchRow tone="green" glyph={<ShieldAlert className="ic" />} label="Hide Sensitive Details" meta="Health reminders say only that there is one" on={p.privateAlerts} onToggle={() => patch({ privateAlerts: !p.privateAlerts })} ariaLabel="Hide sensitive details" />
      </Group>
      <Group label="Morning">
        <MenuRow tone="orange" glyph={<Bell className="ic" />} label="Tomorrow Morning Means" value={morning} word={clock(morning)} ariaLabel="Morning time"
          options={["06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00"].map((v) => ({ value: v, label: clock(v) }))}
          onPick={setMorning} />
      </Group>
      <Group label="Alerts on This Phone">
        {native && onTest && !denied && <Row tone="red" glyph={<Bell className="ic" />} label={testing ? "Sending" : "Send a Test Reminder"} meta="Arrives in 10 seconds" onClick={testing ? undefined : onTest} chev />}
        <Note>
          {!native
            ? "Alerts need the phone app · On the web reminders show inside JARVIS only"
            : denied
              ? "Notifications are off for JARVIS in iOS Settings · Turn them on there and nothing here has to change"
              : permission === "prompt"
                ? "iOS will ask to allow notifications the first time a reminder is set"
                : "Reminders arrive on this phone"}
        </Note>
      </Group>
    </FormSheet>
  );
}
