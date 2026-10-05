import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Switch, Row, Menu, Foot, focusField } from "./kit";
import { Capacitor } from "@capacitor/core";
import { readHealthSettings, updateHealthSettings, SHORTCUTS, WORKING_SHORTCUTS, type HealthSettings, type ShortcutKey } from "../health/settings";
import { readGymSettings, writeGymSettings } from "../gym/settings";
import { HARD_SET_RANGE } from "../gym/muscles";
import { RackSettings } from "./TrainingPage";

// HEALTH SETTINGS (Health Push C, H-40, Dave's picks 2026-09-12), reached
// from the Health page. Shortcuts (Water, the one that adds a row to Log
// Something), the session (rest sound, rest notification, last time on every set,
// celebrations), the weekly sets band the Weekly Volume card compares
// against (Dave 2026-09-13: "I don't want anything hard wired that shouldn't
// be"), and the rack, the same controls Settings, Training already carries.
export interface HealthDoorRow { key: string; group: string; label: string; sub: string }

export default function HealthSettingsPage({ onBack, onEnableWater, doors = [], onOpenDoor, workoutReminder, onWorkoutReminder }: {
  onBack: () => void;
  /** Turning the Water shortcut on seeds its metric (H-43). */
  onEnableWater?: () => void;
  /** 2026-09-14 (the reference's Reminders): one workout reminder at a time
   *  he chooses, a reminder task filed to this area. Null when there is
   *  none; the switch and the time row are absent without the seam. */
  workoutReminder?: { time: string } | null;
  onWorkoutReminder?: (time: string | null) => void;
  /** Part 3 wave 4 (Dave 15a): the Student template's other health screens,
   *  grouped, now live here instead of behind a More door on the page. */
  doors?: HealthDoorRow[];
  onOpenDoor?: (key: string) => void;
}) {
  const [s, setS] = useState<HealthSettings>(() => readHealthSettings());
  // The time input wants HH:MM; the row beside it says nothing raw.
  const reminderClock = workoutReminder ? workoutReminder.time : "17:30";
  const set = (patch: Partial<HealthSettings>) => setS(updateHealthSettings(patch));
  const [showLast, setShowLast] = useState(() => readGymSettings().showLast);
  const toggleShowLast = () => {
    const g = readGymSettings();
    writeGymSettings({ ...g, showLast: !g.showLast });
    setShowLast(!g.showLast);
  };
  const toggleShortcut = (k: ShortcutKey) => {
    const on = s.shortcuts.includes(k);
    set({ shortcuts: on ? s.shortcuts.filter((x) => x !== k) : [...s.shortcuts, k] });
    if (!on && k === "water") onEnableWater?.();
  };
  const band = s.volumeBand ?? { low: HARD_SET_RANGE.low, high: HARD_SET_RANGE.high };
  // Local text for the two fields, so a backspace-to-empty mid-edit does not
  // snap back every keystroke; only a band that makes sense reaches the store.
  const [lowIn, setLowIn] = useState(String(band.low));
  const [highIn, setHighIn] = useState(String(band.high));
  const commitBand = (low: number, high: number) => {
    if (Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > low) set({ volumeBand: { low, high } });
  };
  const useStudied = () => {
    set({ volumeBand: null });
    setLowIn(String(HARD_SET_RANGE.low));
    setHighIn(String(HARD_SET_RANGE.high));
  };
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Health Settings" back="Health" onBack={onBack} />
      <Head label="Shortcuts" />
      {/* 2026-10-04: Log Something always lists Bedtime, Meal, Check In, Session
          Effort, Discomfort and Medication, so a chip for any of them changed
          nothing. Water is the one a chip still decides. */}
      <Card>
        {/* row-tap: chip strip, every inch of it is one of the shortcut chips */}
        <div className="row set-row">
          <div className="chip-row chip-wrap-row" role="group" aria-label="Shortcuts">
            {SHORTCUTS.filter(({ key }) => WORKING_SHORTCUTS.includes(key)).map(({ key, label }) => {
              const on = s.shortcuts.includes(key);
              return (
                <div key={key} className={"chip" + (on ? " active" : "")} role="button" tabIndex={0} aria-pressed={on} onClick={() => toggleShortcut(key)}>{label}</div>
              );
            })}
          </div>
        </div>
      </Card>
      <Foot>Water adds a row to Log Something · The other loggers are always there · Your own metrics are chosen from Add</Foot>
      {onWorkoutReminder && (
        <>
          <Head label="Reminders" />
          <Card>
            <Switch label="Workout Reminder" meta={workoutReminder ? "Every Day, on Your Reminders" : "One Reminder, at a Time You Choose"} on={!!workoutReminder}
              onToggle={() => onWorkoutReminder(workoutReminder ? null : "17:30")} />
            {workoutReminder && (
              <div className="row set-row" onClick={focusField}>
                <div className="conn-name">Reminder Time</div>
                <input className="set-field" type="time" aria-label="Reminder time" value={reminderClock}
                  onChange={(e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) onWorkoutReminder(e.target.value); }} />
              </div>
            )}
          </Card>
        </>
      )}
      <Head label="Session" />
      <Card>
        <Switch label="Rest Timer Sound" meta="Three Notes When the Rest Is Over" on={s.restSound} onToggle={() => set({ restSound: !s.restSound })} />
        {/* A lock-screen alert is the native app's own; the web build never
            schedules one, so there the switch would change nothing (2026-10-04). */}
        {Capacitor.isNativePlatform() && <Switch label="Rest Notification" meta="A Buzz on the Lock Screen When the Rest Is Over" on={s.restNotify} onToggle={() => set({ restNotify: !s.restNotify })} />}
        <Switch label="Last Time on Every Set" meta="Last Session Beside Each Set, with Tap-to-Match" on={showLast} onToggle={toggleShowLast} />
        <Switch label="Celebrations" meta="The PR Mark, and New Best on the Receipt" on={s.celebrations} onToggle={() => set({ celebrations: !s.celebrations })} />
        {/* Part 3 wave 5: the progression engine's mode, easy to change. Two
            modes since 2026-10-04: Program did what Manual does. */}
        <Menu label="Progression" meta={s.progression === "assisted" ? "A Next Target from Your Completed Sets, with Its Basis on Tap" : "No Suggestions"}
          value={s.progression} ariaLabel="Progression"
          options={[{ value: "assisted", label: "Assisted" }, { value: "manual", label: "Manual" }]}
          onPick={(v) => set({ progression: v === "manual" ? "manual" : "assisted" })} />
      </Card>
      <Head label="Weekly Sets" />
      <Card>
        <div className="row set-row" onClick={focusField}>
          <div className="conn-name">Low</div>
          <input className="set-field" type="number" inputMode="numeric" aria-label="Weekly sets low" value={lowIn}
            onChange={(e) => { setLowIn(e.target.value); commitBand(Number(e.target.value), Number(highIn)); }}
            onBlur={() => setLowIn(String((readHealthSettings().volumeBand ?? HARD_SET_RANGE).low))} />
        </div>
        <div className="row set-row" onClick={focusField}>
          <div className="conn-name">High</div>
          <input className="set-field" type="number" inputMode="numeric" aria-label="Weekly sets high" value={highIn}
            onChange={(e) => { setHighIn(e.target.value); commitBand(Number(lowIn), Number(e.target.value)); }}
            onBlur={() => setHighIn(String((readHealthSettings().volumeBand ?? HARD_SET_RANGE).high))} />
        </div>
        {s.volumeBand && <Row label="Use the Studied Range" meta={`${HARD_SET_RANGE.low} to ${HARD_SET_RANGE.high} Working Sets per Muscle per Week`} onClick={useStudied} />}
      </Card>
      <div className="pad-x"><div className="input-hint">{s.volumeBand ? "Your band, the one Weekly Volume compares against" : `The studied range, ${HARD_SET_RANGE.source}`}</div></div>
      <Head label="Rack" />
      <RackSettings />
      {onOpenDoor && [...new Set(doors.map((d) => d.group))].map((g) => (
        <div key={g}>
          <Head label={g} />
          <Card>
            {doors.filter((d) => d.group === g).map((d) => (
              <Row key={d.key} label={d.label} meta={d.sub} onClick={() => onOpenDoor(d.key)} />
            ))}
          </Card>
        </div>
      ))}
      <div className="screen-foot" />
    </div>
  );
}
