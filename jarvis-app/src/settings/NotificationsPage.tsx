import { useCallback, useEffect, useState } from "react";
import { useProfile } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { updateHealthSettings } from "../health/settings";
import { Capacitor } from "@capacitor/core";
import { requestNotificationPermission, notificationPermissionState, sendTestReminder, TEST_REMINDER_DELAY_S, type NotifyPermission } from "../shared/notifications";
import { Head, Card, Switch, Foot, Menu, Row } from "./kit";
import { morningTime, setMorningTime } from "../tasks/quickReminder";
import { fmtTime } from "../schedule/calendar";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { useAccessToken } from "../data/NotesProvider";
import { currentStatus, enableWebPush, disableWebPush, sendTestAlert, resubscribeIfNeeded, footFor, switchLocked, type WebPushStatus } from "../shared/webPush";

type Prefs = { overdue: boolean; events: boolean; goals: boolean; checkins: boolean; rest: boolean };
const DEFAULT: Prefs = { overdue: true, events: true, goals: true, checkins: true, rest: true };

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
  // SHELL-F-14 (2026-09-05): the switch flipped, the write failed, nothing
  // said so, and the old setting was back on the next launch. Guarded, and
  // the switch goes back to what is actually stored.
  const set = async (patch: Partial<Prefs>) => {
    const prev = prefs;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const ok = await attemptWrite(() => svc.save({ notify: next }));
    if (!ok) { setPrefs(prev); return; }
    if (Object.values(patch).some((on) => on === true)) await requestNotificationPermission();
    // SHARED-F-02: whatever the ask returned, re-read the OS state so the
    // foot and the locks below tell the truth about the answer just given.
    readPerm();
  };
  const native = Capacitor.isNativePlatform();
  const denied = perm === "denied";
  // WEB PUSH (2026-09-20, Dave's go through Clemenza). The web half of this
  // page: one master switch behind a real tap, gated on a Home Screen launch
  // and iOS 16.4, with a sentence for every state, and a test row. It is all
  // or nothing: the server sends every alert to every device and the four
  // switches below only shape the in-app screen. The copy says so.
  const accessToken = useAccessToken();
  const deps = { getToken: () => accessToken };
  const [web, setWeb] = useState<WebPushStatus | null>(null);
  const [webBusy, setWebBusy] = useState(false);
  const readWeb = useCallback(() => { if (!native) void currentStatus({ getToken: () => accessToken }).then(setWeb); }, [native, accessToken]);
  useEffect(() => { readWeb(); }, [readWeb]);
  useEffect(() => {
    if (native || !accessToken) return;
    void resubscribeIfNeeded({ getToken: () => accessToken }).then((r) => { if (r === "resubscribed" || r === "failed") readWeb(); });
  }, [native, accessToken, readWeb]);
  const toggleWeb = () => {
    if (webBusy || !web) return;
    setWebBusy(true);
    // enableWebPush calls Notification.requestPermission before its first
    // await, so this synchronous call from the tap is what keeps the dialog
    // legal on iOS. Nothing may be awaited before it.
    const p: Promise<string> = web === "on" ? disableWebPush(deps).then((ok) => (ok ? "off" : "failed")) : enableWebPush(deps);
    void p.then((r) => {
      setWebBusy(false);
      if (r === "denied") showToast({ message: "Notifications are off for JARVIS in iOS Settings" });
      else if (r === "dismissed") showToast({ message: "Not allowed yet · Turn it on whenever you are ready" });
      else if (r === "no-key") showToast({ message: "The server has no push key yet" });
      else if (r === "failed") showToast({ message: "Could not change alerts on this phone · Try again" });
      else if (r === "unauthenticated") showToast({ message: "Sign in again to set up alerts" });
      readWeb();
    });
  };
  const [webTesting, setWebTesting] = useState(false);
  const sendWebTest = async () => {
    if (webTesting) return;
    setWebTesting(true);
    const r = await sendTestAlert(deps);
    setWebTesting(false);
    showToast({ message: r === "sent" ? "Test alert sent · Lock the phone to see it" : r === "unauthenticated" ? "Sign in again to send a test" : "The server could not send a test alert" });
  };
  // THE REMINDERS REBUILD (push D): "morning" is one setting for the whole
  // app (every Tomorrow Morning shortcut means it), and a test send shows
  // what a reminder looks like on this phone.
  const [morning, setMorning] = useState(morningTime());
  const morningWord = (hhmm: string) => { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; };
  const [testing, setTesting] = useState(false);
  const sendTest = async () => {
    if (testing) return;
    setTesting(true);
    const r = await sendTestReminder();
    setTesting(false);
    showToast({ message: r === "sent" ? `Test reminder in ${TEST_REMINDER_DELAY_S} seconds · Lock the phone to see it` : r === "denied" ? "Notifications are off for JARVIS in iOS Settings" : "Test reminders need the phone app" });
  };
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Notifications" back="Settings" onBack={onBack} />
      {!native && (
        <>
          <Head label="This Phone" />
          <Card>
            <Switch label="Alerts on this phone" meta={web === null ? "Checking" : undefined} on={web === "on"} locked={web === null || webBusy || switchLocked(web)} onToggle={toggleWeb} ariaLabel="Alerts on this phone" />
            {web === "on" && <Row label={webTesting ? "Sending" : "Send a Test Alert"} meta="Arrives in a few seconds" onClick={() => void sendWebTest()} disabled={webTesting} chev />}
          </Card>
        </>
      )}
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
        {/* UP-ATH-03 (2026-09-06): the rest timer's buzz between sets. The
            only alert on this page the athlete asked for by starting the
            thing that schedules it, which is why it is last and why it is
            on by default. */}
        <Switch label="Rest timer" on={prefs.rest} locked={denied} onToggle={() => { updateHealthSettings({ restNotify: !prefs.rest }); void set({ rest: !prefs.rest }); }} />
      </Card>
      {/* A4 (audit 2026-08-21, catalog Q8: never promise what the platform
          cannot do). A page called Notifications with four switches on it
          reads as phone alerts. On the web these switches only decide what
          appears on the Notifications screen inside the app, because the
          notification seam is a deliberate no-op off native: a PWA that asks
          for permission it will not use well has spent that permission for
          nothing. Say so once, plainly, instead of letting him find out by
          waiting for a buzz that was never coming. */}
      <Head label="Reminders" />
      <Card>
        <Menu label="Morning" meta="What Tomorrow Morning means" value={morning} word={morningWord(morning)} ariaLabel="Morning time"
          options={["06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00"].map((v) => ({ value: v, label: morningWord(v) }))}
          onPick={(v) => { setMorning(v); setMorningTime(v); }} />
        {native && <Row label={testing ? "Sending" : "Send a Test Reminder"} meta={denied ? "Off in iOS Settings" : `Arrives in ${TEST_REMINDER_DELAY_S} seconds`} onClick={() => void sendTest()} disabled={denied || testing} chev />}
      </Card>
      <Foot>
        {!native
          ? (web === null ? "Checking whether this phone can get alerts" : footFor(web))
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
