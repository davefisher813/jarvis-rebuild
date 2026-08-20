// DESIGNING FOR THE RETURN (E1, approved 2026-08-20).
//
// The abandonment research is consistent: people stop using apps like this
// and come back, and they treat that as normal rather than as failure. The
// apps punish them for it anyway. You return after two weeks to a wall of
// overdue, which is the app's way of saying "look what you did", and that is
// the moment most people quit for good.
//
// So the return gets designed on purpose:
//   - NO COUNT OF WHAT PILED UP. The number is the punishment.
//   - SAY WHAT IS STILL TRUE, not what rotted. Things that aged out on their
//     own are good news: they are work he no longer has to do.
//   - ONE thing to start with, because a returning brain does not need a list.
//   - It appears ONCE, and never scolds.

export const AWAY_DAYS = 5;
const KEY = "jarvis.lastseen.v1";

export function loadLastSeen(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try { return storage.getItem(KEY); } catch { return null; }
}

export function markSeen(todayISO: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, todayISO); } catch { /* private mode */ }
}

function daysBetween(a: string, b: string): number {
  const t = (s: string) => new Date(s + "T12:00:00").getTime();
  return Math.round((t(b) - t(a)) / 86400000);
}

export interface WelcomeBack {
  days: number;
  title: string;
  sub: string;
}

// Null unless he has genuinely been away. A first run is not a return, and
// greeting a brand-new user with "welcome back" is a lie in the first second.
export function welcomeBack(
  lastSeen: string | null,
  todayISO: string,
  agedOut: number,
): WelcomeBack | null {
  if (!lastSeen) return null;
  const days = daysBetween(lastSeen, todayISO);
  if (days < AWAY_DAYS) return null;
  const gone = agedOut > 0
    ? `${agedOut === 1 ? "One thing" : agedOut + " things"} aged out on their own`
    : "Nothing was lost";
  return {
    days,
    title: "Welcome Back",
    // Never the pile. What is true, and what he no longer has to carry.
    sub: `${gone} · Start with one?`,
  };
}
