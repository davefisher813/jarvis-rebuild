import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { readGymSettings, writeGymSettings, type GymSettings } from "../gym/settings";
import { Head, Card, Switch } from "./kit";

export default function TrainingPage({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<GymSettings>(() => readGymSettings());
  const set = (patch: Partial<GymSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    writeGymSettings(next);
  };
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Training" back="Settings" onBack={onBack} />
      <Head label="In the Gym" />
      <Card>
        <Switch label="Last Time on Every Set" meta="Last session beside each set, with tap-to-match" on={settings.showLast}
          onToggle={() => set({ showLast: !settings.showLast })} />
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
