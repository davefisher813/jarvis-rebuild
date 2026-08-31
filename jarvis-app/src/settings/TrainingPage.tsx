import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { haptics } from "../shared/haptics";
import { readGymSettings, writeGymSettings, type GymSettings } from "../gym/settings";

// SETTINGS → TRAINING (Training Catalog V2, approved 2026-08-31). D2's one
// switch lives here: last-time ghosts default ON ("It should always be
// visible in my opinion unless they want to turn that off"). D8's bar
// weight and available plates join this page in Wave 2 -- that is why a
// whole page exists for one row.
export default function TrainingPage({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<GymSettings>(() => readGymSettings());
  const set = (patch: Partial<GymSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    writeGymSettings(next);
  };
  return (
    <div className="screen">
      <LargeTitleNav title="Training" back="Settings" onBack={onBack} />
      <div className="grp"><div className="eyebrow">In the Gym</div></div>
      <div className="pad-x"><div className="card">
        <div className="row">
          <div className="row-grow">
            <div className="conn-name">Last Time on Every Set</div>
            <div className="conn-meta">Last session beside each set, with tap-to-match</div>
          </div>
          <div className={"switch" + (settings.showLast ? "" : " off")} role="switch" aria-checked={settings.showLast}
            tabIndex={0} onClick={() => { haptics.selection(); set({ showLast: !settings.showLast }); }} />
        </div>
      </div></div>
    </div>
  );
}
