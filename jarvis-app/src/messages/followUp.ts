// NUDGE ME IF THEY DON'T REPLY (N3, Dave 2026-08-20).
//
// Waiting On already finds the loops running the other way, but only after
// the fact: it takes days of silence before a thread qualifies, and by then
// he has already forgotten he was owed anything. This is the version you set
// when you SEND, which is the only moment you actually remember.
//
// Laws:
//   - It cancels itself. If they reply, the chase never fires: the check is
//     "is the last message still mine", which is the same derivation Waiting
//     On uses, so the two can never disagree.
//   - One chase per thread. Setting it twice replaces, never stacks.
//   - It fires as an OFFER (a card with a drafted nudge), never as a sent
//     message. Nothing leaves over his name without a tap.

const KEY = "jarvis.mail.chase.v1";
const CAP = 100;
export const CHASE_DAYS = [2, 3, 7];
export const CHASE_DEFAULT = 3;

export interface Chase {
  threadId: string;
  to: string;
  subject: string;
  dueISO: string;   // the day the chase becomes live
  setISO: string;   // the day he asked for it, for the receipt
}

export function loadChases(storage: Pick<Storage, "getItem"> = localStorage): Chase[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((c): c is Chase =>
      !!c && typeof (c as Chase).threadId === "string" && typeof (c as Chase).dueISO === "string");
  } catch {
    return [];
  }
}

function save(list: Chase[], storage: Pick<Storage, "setItem">): void {
  try { storage.setItem(KEY, JSON.stringify(list.slice(-CAP))); } catch { /* private mode */ }
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function setChase(
  c: Omit<Chase, "dueISO"> & { days: number },
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Chase {
  const chase: Chase = {
    threadId: c.threadId,
    to: c.to,
    subject: c.subject,
    setISO: c.setISO,
    dueISO: addDays(c.setISO, Math.max(1, c.days)),
  };
  save([...loadChases(storage).filter((x) => x.threadId !== chase.threadId), chase], storage);
  return chase;
}

export function clearChase(
  threadId: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  save(loadChases(storage).filter((c) => c.threadId !== threadId), storage);
}

// Live chases: due, and still unanswered. `answered` is the set of threads
// whose last message is no longer his, derived the same way Waiting On does
// it, so a reply silently retires the chase without him ever seeing it.
export function dueChases(chases: Chase[], todayISO: string, answered: string[]): Chase[] {
  const replied = new Set(answered);
  return chases.filter((c) => c.dueISO <= todayISO && !replied.has(c.threadId));
}

export function chaseLine(c: Chase, todayISO: string): string {
  const days = Math.max(0, Math.round(
    (new Date(c.dueISO + "T12:00:00").getTime() - new Date(todayISO + "T12:00:00").getTime()) / 86400e3));
  if (days === 0) return "Chasing today";
  return days === 1 ? "Chasing tomorrow" : `Chasing in ${days} days`;
}
