import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Switch, Row, Menu } from "./kit";
import { readHealthSettings, updateHealthSettings, SHORTCUTS, type HealthSettings, type ShortcutKey } from "../health/settings";
import { readGymSettings, writeGymSettings } from "../gym/settings";
import { HARD_SET_RANGE } from "../gym/muscles";
import { RackSettings } from "./TrainingPage";

// HEALTH SETTINGS (Health Push C, H-40, Dave's picks 2026-09-12), reached
// from the Health page. Shortcuts (which tiles the Daily Log shows), the
// session (rest sound, rest notification, last time on every set,
// celebrations), the weekly sets band the Weekly Volume card compares
// against (Dave 2026-09-13: "I don't want anything hard wired that shouldn't
// be"), and the rack, the same controls Settings, Training already carries.
export interface HealthDoorRow { key: string; group: string; label: string; sub: string }

export default function HealthSettingsPage({ onBack, onEnableWater, doors = [], onOpenDoor }: {
  onBack: () => void;
  /** Turning the Water shortcut on seeds its metric (H-43). */
  onEnableWater?: () => void;
  /** Part 3 wave 4 (Dave 15a): the Student template's other health screens,
   *  grouped, now live here instead of behind a More door on the page. */
  doors?: HealthDoorRow[];
  onOpenDoor?: (key: string) => void;
}) {
  const [s, setS] = useState<HealthSettings>(() => readHealthSettings());
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
      <div className="pad-x"><div className="input-hint">The tiles under Daily Log. Your own metrics are chosen from Add.</div></div>
      <div className="pad-x"><div className="chip-row chip-wrap-row" role="group" aria-label="Shortcuts">
        {SHORTCUTS.map(({ key, label }) => {
          const on = s.shortcuts.includes(key);
          return (
            <div key={key} className={"chip" + (on ? " active" : "")} role="button" tabIndex={0} aria-pressed={on} onClick={() => toggleShortcut(key)}>{label}</div>
          );
        })}
      </div></div>
      <Head label="Session" />
      <Card>
        <Switch label="Rest Timer Sound" meta="Three notes when the rest is over" on={s.restSound} onToggle={() => set({ restSound: !s.restSound })} />
        <Switch label="Rest Notification" meta="A buzz on the lock screen when the rest is over" on={s.restNotify} onToggle={() => set({ restNotify: !s.restNotify })} />
        <Switch label="Last Time on Every Set" meta="Last session beside each set, with tap-to-match" on={showLast} onToggle={toggleShowLast} />
        <Switch label="Celebrations" meta="The PR mark, and New Best on the receipt" on={s.celebrations} onToggle={() => set({ celebrations: !s.celebrations })} />
        {/* Part 3 wave 5: the progression engine's mode, easy to change. */}
        <Menu label="Progression" meta={s.progression === "assisted" ? "A next target from your completed sets, with its basis on tap" : s.progression === "manual" ? "No suggestions" : "The plan as written"}
          value={s.progression} ariaLabel="Progression"
          options={[{ value: "assisted", label: "Assisted" }, { value: "manual", label: "Manual" }, { value: "program", label: "Program" }]}
          onPick={(v) => set({ progression: v === "manual" ? "manual" : v === "program" ? "program" : "assisted" })} />
      </Card>
      <Head label="Weekly Sets" />
      <Card>
        <div className="row set-row">
          <div className="conn-name">Low</div>
          <input className="set-field" type="number" inputMode="numeric" aria-label="Weekly sets low" value={lowIn}
            onChange={(e) => { setLowIn(e.target.value); commitBand(Number(e.target.value), Number(highIn)); }}
            onBlur={() => setLowIn(String((readHealthSettings().volumeBand ?? HARD_SET_RANGE).low))} />
        </div>
        <div className="row set-row">
          <div className="conn-name">High</div>
          <input className="set-field" type="number" inputMode="numeric" aria-label="Weekly sets high" value={highIn}
            onChange={(e) => { setHighIn(e.target.value); commitBand(Number(lowIn), Number(e.target.value)); }}
            onBlur={() => setHighIn(String((readHealthSettings().volumeBand ?? HARD_SET_RANGE).high))} />
        </div>
        {s.volumeBand && <Row label="Use the Studied Range" meta={`${HARD_SET_RANGE.low} to ${HARD_SET_RANGE.high} working sets per muscle per week`} onClick={useStudied} />}
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
