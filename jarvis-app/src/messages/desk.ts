// AT A DESK (UP-MIND-09, email handoff E7: "visible deferral").
//
// The move everyone already makes and no mail app supports: you read a thread
// on the phone, you cannot answer it from the phone -- it needs a file, a
// spreadsheet, a real keyboard, ten quiet minutes -- and you mark it unread so
// it comes back. Mark-unread is a terrible deferral. It says nothing about
// WHY, it puts the thread back in the same pile it just left, and the pile is
// where it gets lost.
//
// "At a Desk" is the honest version. The thread leaves the phone view at once,
// a count rides the Email tab so it is never invisible, and the threads come
// back TOGETHER, at the top, the next time the person is somewhere they can
// actually act: a wide screen, or any open after the working day's end.
//
// Two laws this file exists to keep:
//   - NEVER LOST. A deferred thread is always countable and always reachable;
//     nothing here can drop one silently. That is why the count is on the tab
//     rather than inside the list.
//   - NEVER NAGGING. It does not notify, badge red, or climb an urgency
//     ladder. Deferring is the person saying "not here"; answering that with
//     a pester is how a deferral feature becomes a second inbox.
//
// This does NOT touch Gmail. Like mute.ts and letGo.ts, it is a local view
// decision mirrored across the person's own devices (mailSync.ts), so the
// thread deferred on the phone is waiting on the laptop.

export const KEY = "jarvis.mail.desk.v1";
const CAP = 200;

/** threadId -> when it was set aside, ISO. The timestamp is what lets the
 *  section say "since Tuesday" and what orders the list oldest-first: the
 *  thing set aside longest ago is the one most at risk of being forgotten,
 *  so it is the one at the top. */
export type DeskMap = Record<string, string>;

/** Wide enough to be a real keyboard, per the handoff. Exported so the
 *  component and the test agree on one number. */
export const DESK_WIDE_MIN_PX = 700;

/** The fallback "you are done for the day" hour when the routine has no
 *  work-end block to read. 5 PM, local. */
export const DESK_DEFAULT_END_MIN = 17 * 60;

export function loadDesk(storage: Pick<Storage, "getItem"> = localStorage): DeskMap {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: DeskMap = {};
    for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof at === "string" && at) out[id] = at;
    }
    return out;
  } catch {
    return {};
  }
}

// Oldest entries fall off first, so the cap can never evict the thread set
// aside a minute ago in favour of one from March.
function save(map: DeskMap, storage: Pick<Storage, "setItem">): DeskMap {
  const entries = Object.entries(map).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const next = Object.fromEntries(entries.slice(-CAP));
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

/** Set a thread aside for a desk. Re-setting one already set aside keeps the
 *  ORIGINAL time: the point of the timestamp is how long this has been
 *  waiting, and a second tap is not a new wait. */
export function setAtDesk(
  threadId: string,
  now: () => number = Date.now,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): DeskMap {
  const all = loadDesk(storage);
  if (all[threadId]) return all;
  return save({ ...all, [threadId]: new Date(now()).toISOString() }, storage);
}

/** Take it back off the desk list: the Undo on the toast, and what opening
 *  and acting on the thread does. */
export function clearAtDesk(
  threadId: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): DeskMap {
  const all = loadDesk(storage);
  if (!all[threadId]) return all;
  const next = { ...all };
  delete next[threadId];
  return save(next, storage);
}

export function isAtDesk(threadId: string, desk: DeskMap): boolean {
  return Boolean(desk[threadId]);
}

/** What the Email tab says. Zero means the tab says nothing at all: a badge
 *  reading 0 is the nagging this feature promised not to do. */
export function deskCount(desk: DeskMap): number {
  return Object.keys(desk).length;
}

/** "4 For a Desk". Null at zero so the caller renders nothing rather than
 *  branching on a string. */
export function deskLine(desk: DeskMap): string | null {
  const n = deskCount(desk);
  return n === 0 ? null : `${n} For a Desk`;
}

/** Off the phone view. The deferral has to be VISIBLE as a removal or the
 *  person will not trust it enough to use it a second time. */
export function dropAtDesk<T extends { id: string }>(rows: T[], desk: DeskMap): T[] {
  if (deskCount(desk) === 0) return rows;
  return rows.filter((r) => !desk[r.id]);
}

/** The threads to greet a desk with, longest-waiting first. Rows the desk
 *  list names but the inbox no longer carries (archived elsewhere, or older
 *  than the loaded page) simply do not appear here; `deskCount` still counts
 *  them, so nothing is claimed to be gone that is not. */
export function deskRows<T extends { id: string }>(rows: T[], desk: DeskMap): T[] {
  if (deskCount(desk) === 0) return [];
  return rows
    .filter((r) => desk[r.id])
    .sort((a, b) => (desk[a.id]! < desk[b.id]! ? -1 : desk[a.id]! > desk[b.id]! ? 1 : 0));
}

/** IS THIS A DESK?
 *
 *  Two ways to be one, either is enough:
 *    - the viewport is wide enough to be a laptop, or
 *    - the working day is over, wherever the person is sitting.
 *
 *  Both are guesses, and both are allowed to be wrong, because being wrong
 *  costs a section at the top of a list the person can scroll past. Getting
 *  it wrong the OTHER way -- never showing them -- is the failure that
 *  matters, so the test is deliberately generous.
 *
 *  `widthPx` is passed in rather than read here so this stays pure and the
 *  component owns the one matchMedia call.
 */
export function isDeskNow(
  widthPx: number,
  nowMin: number,
  workEndMin: number = DESK_DEFAULT_END_MIN,
): boolean {
  if (widthPx >= DESK_WIDE_MIN_PX) return true;
  return nowMin >= workEndMin;
}

/** Minutes since midnight, local, from a Date. Explicit getters, never
 *  toISOString: this app has been bitten by UTC day math enough times that
 *  the local-time rule is a code law here. */
export function minsOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}
