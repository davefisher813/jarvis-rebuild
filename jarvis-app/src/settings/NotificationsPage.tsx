import { useCallback, useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Capacitor } from "@capacitor/core";
import { requestNotificationPermission, notificationPermissionState, type NotifyPermission } from "../shared/notifications";
import { Head, Card, Switch, Foot } from "./kit";

type Prefs = { overdue: boolean; events: boolean; goals: boolean; checkins: boolean };
const DEFAULT: Prefs = { overdue: true, events: true, goals: true, checkins: true };

export default function NotificationsPage({ onBack }: { onBack: () => void }) {
  const svc = useProfile();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  useEffect(() => { void svc.get().then((p) => setPrefs({ ...DEFAULT, ...(p?.notify ?? {}) })); }, [svc]);
  // SHARED-F-02 (2026-09-05): the seam has always reported denial truthfully
  // and this page threw the answer away (`void requestNotificationPermission()`),
  // then printed "Check-ins and event reminders arrive on this phone" whatever
  // iOS had decided. With notifications denied in Settings, all four switches
  // turned on, saved, and promised alerts that every scheduler in the seam
  // silently declines to schedule. The page asks the OS what is true, on open
  // and again after each ask, and says that instead.
  const [perm, setPerm] = useState<NotifyPermission>("unsupported");
  const readPerm = useCallback(() => { void notificationPermissionState().then(setPerm); }, []);
  useEffect(() => { readPerm(); }, [readPerm]);
  // S1-03: this page is the honest place to ask for the OS permission its
  // own copy promises, the first time ANY switch goes on, not just Daily
  // check-ins. Turning off checkins while leaving events on used to leave
  // nothing that ever asked, so the event ladder was permanently blocked.
  const set = async (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await svc.save({ notify: next });
    if (Object.values(patch).some((on) => on === true)) await requestNotificationPermission();
    readPerm();
  };
  const native = Capacitor.isNativePlatform();
  const denied = perm === "denied";
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Notifications" back="Settings" onBack={onBack} />
      <Head label="Tell Me About" />
      <Card>
        {/* Denied at the OS level: the switches are shown, and locked. They
            are not lying about their own state (the preference really is on
            or off, and it still filters the in-app Notifications screen), but
            flipping one cannot make a single alert arrive, and a control that
            answers a tap with nothing at all is worse than one that says why.
            The foot below carries the why. */}
        <Switch label="Overdue and due tasks" on={prefs.overdue} locked={denied} onToggle={() => set({ overdue: !prefs.overdue })} />
        <Switch label="Today's events" on={prefs.events} locked={denied} onToggle={() => set({ events: !prefs.events })} />
        <Switch label="Daily check-ins" on={prefs.checkins} locked={denied} onToggle={() => set({ checkins: !prefs.checkins })} />
        <Switch label="Goal and life-area nudges" on={prefs.goals} locked={denied} onToggle={() => set({ goals: !prefs.goals })} />
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
        {!native
          ? "On the web these only decide what shows on the Notifications screen."
          : denied
            ? "Notifications are off for JARVIS in iOS Settings · Turn them on there and nothing here has to change"
            : perm === "prompt"
              // Asked for the first time by turning a switch on, which is what
              // S1-03 moved here. Saying so beats promising alerts that are
              // one unanswered dialog away from never coming.
              ? "Turn one on and iOS will ask to allow notifications."
              : "Check-ins and event reminders arrive on this phone."}
      </Foot>
      <div className="screen-foot" />
    </div>
  );
}
