import { useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { haptics } from "../shared/haptics";
import { Capacitor } from "@capacitor/core";

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
  const native = Capacitor.isNativePlatform();
  return (
    <div className="screen">
      <LargeTitleNav title="Notifications" back="Settings" onBack={onBack} />
      <div className="pad-x"><div className="card">
        <SwitchRow name="Overdue and due tasks" on={prefs.overdue} onToggle={() => set({ overdue: !prefs.overdue })} />
        <SwitchRow name="Today's events" on={prefs.events} onToggle={() => set({ events: !prefs.events })} />
        <SwitchRow name="Daily check-ins" on={prefs.checkins} onToggle={() => set({ checkins: !prefs.checkins })} />
        <SwitchRow name="Goal and life-area nudges" on={prefs.goals} onToggle={() => set({ goals: !prefs.goals })} />
      </div></div>
      {/* A4 (audit 2026-08-21, catalog Q8: never promise what the platform
          cannot do). A page called Notifications with four switches on it
          reads as phone alerts. On the web these switches only decide what
          appears on the Notifications screen inside the app, because the
          notification seam is a deliberate no-op off native: a PWA that asks
          for permission it will not use well has spent that permission for
          nothing. Say so once, plainly, instead of letting him find out by
          waiting for a buzz that was never coming. */}
      <div className="pad-x conn-status notif-scope">
        {native
          ? "Check-ins and event reminders arrive on this phone."
          : "On the web these only decide what shows on the Notifications screen."}
      </div>
    </div>
  );
}
