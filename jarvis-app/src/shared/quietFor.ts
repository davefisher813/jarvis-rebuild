// QUIET FOR A WHILE, KEYED BY THING (Dave 2026-08-29, notice audit).
//
// LAW 2 says a dismissal expires. Three days is long enough that waving a
// card off actually buys quiet, and short enough that something still true
// next week gets to speak again. Forever-silence and daily-nagging are both
// failures, and this app had shipped one of each: the sweep's offered-list
// muted a sliding task permanently, while the finished-project card came
// back every single day until he closed a project he was deliberately
// keeping open.
//
// The shape was already in the codebase twice by hand (goalPulse's goal
// nudge, autoSweep's offered list) before this existed. It lives here now so
// the fourth one does not have to be written a fourth time, and so "how long
// is quiet" is one number in one place. The two originals still carry their
// own copies; they work and are covered by their own tests, and rewriting
// them buys nothing but risk.
//
// Storage is injectable so tests never touch localStorage, matching how
// goalPulse does it.

export interface QuietStore { read(): string | null; write(v: string): void }

export const QUIET_DAYS = 3;

export function localQuietStore(key: string): QuietStore {
  return {
    read: () => { try { return localStorage.getItem(key); } catch { return null; } },
    write: (v) => { try { localStorage.setItem(key, v); } catch { /* private mode */ } },
  };
}

// Whole days between two ISO dates. Local noon so a DST shift cannot round
// a day away.
function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T12:00:00").getTime();
  const b = new Date(to + "T12:00:00").getTime();
  return Math.round((b - a) / 86400000);
}

export function isQuiet(id: string, todayIso: string, store: QuietStore, days = QUIET_DAYS): boolean {
  try {
    const d = JSON.parse(store.read() || "{}") as Record<string, string>;
    const when = d[id];
    return !!when && daysBetween(when, todayIso) < days;
  } catch {
    return false;
  }
}

export function goQuiet(id: string, todayIso: string, store: QuietStore): void {
  try {
    const d = JSON.parse(store.read() || "{}") as Record<string, string>;
    d[id] = todayIso;
    store.write(JSON.stringify(d));
  } catch { /* private mode: the card comes back, which is the safe failure */ }
}
