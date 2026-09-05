import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { readGymSettings, writeGymSettings, type GymSettings } from "../gym/settings";
import { Head, Card, Switch } from "./kit";

// S5-Q32 (2026-09-04): "bar weight and plates have no control." Every plate
// calculation and warm-up ramp already reads GymSettings.barWeight/.plates
// (gym/settings.ts) -- the store, the six readers and the rackFrom fallback
// were all built; only this page's controls were missing, so every gym was
// stuck on the 45 lb-bar imperial default and a kilos gym got wrong numbers
// on every screen. No unit toggle exists anywhere in the app (per-exercise
// units are the only unit concept there is), so the bar field is a plain
// number -- his own bar's number, whatever system he trains in -- and the
// plate list below is both standard sets at once, unlabelled by unit for the
// same reason: he picks the ones his rack actually has.
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
