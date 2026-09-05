import { useEffect, useState } from "react";
import { todayISO } from "../tasks/grouping";

// TODAY-F-02 (2026-09-05): THE DAY CHANGED AND TODAY DID NOT.
//
// Every "first open of the day" job on Today is keyed to component mount:
// the overdue sweep, the autopay roll-forward, the Where You Were spot, the
// Day Loop draft read, the Fresh Start skip marker, the last-seen stamp,
// MailNotices' dismissals. The component is not remounted on a day change,
// though. Leave JARVIS open on Today overnight and only `today` moves: the
// minute tick flips it and reload() refetches for the new date, while
// yesterday's tasks are never swept, autopay bills never roll, Fresh Start
// stays waved off, yesterday's mail dismissals still hide today's notices,
// and the Day Loop card still offers YESTERDAY's undecided draft, which
// Accept then commits onto today.
//
// The cheapest honest fix is to let the day be part of the identity: this
// key changes when the local date does, AppShell hangs it on TodayFlow, and
// React does the rest, because "once per open" is exactly what every one of
// those effects already says it wants.
//
// Two triggers, deliberately. The interval catches a phone left awake on the
// screen at midnight (up to a minute late, which is fine for a day boundary).
// visibilitychange catches the ordinary case, a phone that was asleep since
// last night: it fires when the WKWebView comes back to the foreground, so
// the remount happens as the screen lights up rather than up to a minute
// into reading a stale page.
export function useDayKey(): string {
  const [day, setDay] = useState(todayISO);
  useEffect(() => {
    const check = () => setDay((cur) => { const now = todayISO(); return now === cur ? cur : now; });
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(check, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, []);
  return day;
}
