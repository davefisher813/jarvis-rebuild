import { useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Capacitor } from "@capacitor/core";
import { Head, Card, Switch, Foot } from "./kit";

type Prefs = { overdue: boolean; events: boolean; goals: boolean; checkins: boolean };
const DEFAULT: Prefs = { overdue: true, events: true, goals: true, checkins: true };

export default function NotificationsPage({ onBack }: { onBack: () => void }) {
  const svc = useProfile();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  useEffect(() => { void svc.get().then((p) => setPrefs({ ...DEFAULT, ...(p?.notify ?? {}) })); }, [svc]);
  const set = async (patch: Partial<Prefs>) => { const next = { ...prefs, ...patch }; setPrefs(next); await svc.save({ notify: next }); };
  const native = Capacitor.isNativePlatform();
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Notifications" back="Settings" onBack={onBack} />
      <Head label="Tell Me About" />
      <Card>
        <Switch label="Overdue and due tasks" on={prefs.overdue} onToggle={() => set({ overdue: !prefs.overdue })} />
        <Switch label="Today's events" on={prefs.events} onToggle={() => set({ events: !prefs.events })} />
        <Switch label="Daily check-ins" on={prefs.checkins} onToggle={() => set({ checkins: !prefs.checkins })} />
        <Switch label="Goal and life-area nudges" on={prefs.goals} onToggle={() => set({ goals: !prefs.goals })} />
      </Card>
      {/* A4 (audit 2026-08-21, catalog Q8: never promise what the platform
          cannot do). A page called Notifications with four switches on it
          reads as phone alerts. On the web these switches only decide what
          appears on the Notifications screen inside the app, because the
          notification seam is a deliberate no-op off native: a PWA that asks
          for permission it will not use well has spent that permission for
          nothing. Say so once, plainly, instead of letting him find out by
          waiting for a buzz that was never coming. */}
      <Foot>
        {native
          ? "Check-ins and event reminders arrive on this phone."
          : "On the web these only decide what shows on the Notifications screen."}
      </Foot>
      <div className="screen-foot" />
    </div>
  );
}
