import { useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { haptics } from "../shared/haptics";

const BACK = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>;
type Prefs = { overdue: boolean; events: boolean; goals: boolean; checkins: boolean };
const DEFAULT: Prefs = { overdue: true, events: true, goals: true, checkins: true };

function SwitchRow({ name, on, onToggle }: { name: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="row"><div className="row-grow"><div className="conn-name">{name}</div></div>
      <div className={"switch" + (on ? "" : " off")} role="switch" aria-checked={on} tabIndex={0} onClick={() => { haptics.selection(); onToggle(); }} /></div>
  );
}

export default function NotificationsPage({ onBack }: { onBack: () => void }) {
  const svc = useProfile();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  useEffect(() => { void svc.get().then((p) => setPrefs({ ...DEFAULT, ...(p?.notify ?? {}) })); }, [svc]);
  const set = async (patch: Partial<Prefs>) => { const next = { ...prefs, ...patch }; setPrefs(next); await svc.save({ notify: next }); };
  return (
    <div className="screen">
      <LargeTitleNav title="Notifications" back="Settings" onBack={onBack} />
      <div className="pad-x"><div className="card">
        <SwitchRow name="Overdue and due tasks" on={prefs.overdue} onToggle={() => set({ overdue: !prefs.overdue })} />
        <SwitchRow name="Today's events" on={prefs.events} onToggle={() => set({ events: !prefs.events })} />
        <SwitchRow name="Daily check-ins" on={prefs.checkins} onToggle={() => set({ checkins: !prefs.checkins })} />
        <SwitchRow name="Goal and life-area nudges" on={prefs.goals} onToggle={() => set({ goals: !prefs.goals })} />
      </div></div>
    </div>
  );
}
