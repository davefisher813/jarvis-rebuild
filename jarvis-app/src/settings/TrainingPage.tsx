import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { readGymSettings, writeGymSettings, type GymSettings } from "../gym/settings";
import { Head, Card, Switch } from "./kit";

// S5-Q32 (2026-09-04): "bar weight and plates have no control." Every plate
// calculation and warm-up ramp already reads GymSettings.barWeight/.plates
// (gym/settings.ts) -- the store, the six readers and the rackFrom fallback
// were all built; only this page's controls were missing, so every gym was
// stuck on the 45 lb-bar imperial default and a kilos gym got wrong numbers
// on every screen. The plate list below is both standard sets at once, so he
// picks the ones his rack actually has.
//
// GYM-F-19 (2026-09-05): S5-Q32 left the bar a bare number with no unit, and
// that is exactly what stopped the ramp and the plate line being right for a
// kg lifter -- the ramp handed back the 45 lb bar with a kg label on it, and
// SetStrip suppressed plate math for kg outright. Exercises have always
// carried a unit; the rack now says which one ITS numbers are in, so the two
// convert. Default lb, which is what every rack stored before this was.
const PLATE_OPTIONS = [45, 35, 25, 20, 15, 10, 5, 2.5, 1.25];

export default function TrainingPage({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<GymSettings>(() => readGymSettings());
  const set = (patch: Partial<GymSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    writeGymSettings(next);
  };
  // Local text so a backspace-to-empty mid-edit does not snap back to the
  // last valid number every keystroke; only a real positive number ever
  // reaches the store (a blank or 0 bar is nonsense rackFrom would have to
  // guess around anyway).
  const [barInput, setBarInput] = useState(String(settings.barWeight));
  const rackUnit = settings.rackUnit === "kg" ? "kg" : "lb";
  const togglePlate = (p: number) => {
    const plates = settings.plates.includes(p) ? settings.plates.filter((x) => x !== p) : [...settings.plates, p];
    set({ plates });
  };
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Training" back="Settings" onBack={onBack} />
      <Head label="In the Gym" />
      <Card>
        <Switch label="Last Time on Every Set" meta="Last session beside each set, with tap-to-match" on={settings.showLast}
          onToggle={() => set({ showLast: !settings.showLast })} />
        <div className="row set-row">
          <div className="conn-name">Rack Unit</div>
          <div className="chip-row">
            {(["lb", "kg"] as const).map((u) => (
              <div key={u} className={"chip" + (rackUnit === u ? " active" : "")} role="button" tabIndex={0}
                aria-pressed={rackUnit === u} onClick={() => set({ rackUnit: u })}>{u}</div>
            ))}
          </div>
        </div>
        <div className="row set-row">
          <div className="conn-name">Bar Weight</div>
          <input className="set-field" type="number" inputMode="decimal" aria-label="Bar Weight" value={barInput}
            onChange={(e) => {
              setBarInput(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isFinite(n) && n > 0) set({ barWeight: n });
            }}
            onBlur={() => setBarInput(String(settings.barWeight))} />
        </div>
      </Card>
      <div className="pad-x"><div className="input-label">Plates on the Rack</div></div>
      <div className="pad-x"><div className="input-hint">In {rackUnit}. A lift logged in the other unit is converted, both ways.</div></div>
      <div className="pad-x"><div className="chip-row chip-wrap-row">
        {PLATE_OPTIONS.map((p) => (
          <div key={p} className={"chip" + (settings.plates.includes(p) ? " active" : "")} role="button" tabIndex={0}
            aria-pressed={settings.plates.includes(p)} onClick={() => togglePlate(p)}>{p}</div>
        ))}
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
