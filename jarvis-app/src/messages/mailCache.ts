import type { ThreadRow } from "../connections/google/map";

// THE INBOX YOU ALREADY READ (Dave 2026-09-16: "It also shouldn't need to
// read my emails every time I go back to the screen it's killing api
// usage").
//
// He is right, and the number is worse than it looks. AppShell renders the
// mail tab as `{active === "messages" && <MessagesFlow/>}`, so switching to
// Today and back is a full unmount and remount, and the mount effect had no
// freshness gate at all. Every visit paid, for one Gmail account:
//
//   threads   1 list + 30 metadata gets      ~31
//   drafts    1 list + up to 25 gets         ~26
//   waiting   1 profile + 1 search + 15      ~17
//   sent      1 search + 8 + 8 FULL bodies   ~17
//   meetings  up to 2 full thread gets        ~2
//                                            ----
//                                            ~93 requests, per visit, per account
//
// Triage was the one pass already cached (jarvis.mail.triage.v4), which is
// why the AI spend never looked alarming while the Gmail spend quietly did.
//
// This module is the missing half: the rows themselves, kept so a remount
// paints instantly, and one timestamp per expensive pass so the pass is
// skipped while its last answer is still good. The precedent is already in
// the repo: MailSnapshotPump refuses to rebuild the home band more often
// than every four hours for exactly this reason.
//
// Laws:
//   - CACHED MAIL IS STILL HIS MAIL. A stale read paints immediately and
//     refreshes behind it; the screen never blanks to spare a request.
//   - A DELIBERATE REFRESH ALWAYS WINS. Pull, Load More, Try Again and any
//     write that changes the inbox force the read regardless of freshness.
//   - NOTHING HERE IS A DECISION. It only says what was last read and when.

export const ROWS_KEY = "jarvis.mail.rows.v1";
export const READS_KEY = "jarvis.mail.reads.v1";

/** Rows older than this are not worth painting at all: a day-old inbox on
 *  screen is a lie of a different kind. Beyond it the screen loads as it
 *  always did, with its spinner. */
export const ROWS_MAX_AGE_MS = 12 * 3600e3;

export type ReadKind = "threads" | "drafts" | "waiting" | "sweep" | "meetings";

/**
 * How long each pass's last answer stays good.
 *
 * The inbox itself is short, because new mail is the thing he came to see.
 * The satellites are long in proportion to what they cost and how slowly
 * their answers actually change: the sent sweep pulls eight FULL message
 * bodies to notice that nobody has replied yet, which is not a fact that
 * moves in five minutes, and it matches MailSnapshotPump's own four hours.
 */
export const FRESH_MS: Record<ReadKind, number> = {
  threads: 3 * 60e3,
  drafts: 30 * 60e3,
  waiting: 30 * 60e3,
  meetings: 60 * 60e3,
  sweep: 4 * 3600e3,
};

export interface CachedRows {
  rows: ThreadRow[];
  /** The page size the rows were read at, so Load More resumes there. */
  page: number;
  ts: number;
}

type Reads = Partial<Record<ReadKind, number>>;

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

export function loadRows(
  now = Date.now(),
  storage: Pick<Storage, "getItem"> = localStorage,
): CachedRows | null {
  try {
    const p = JSON.parse(storage.getItem(ROWS_KEY) || "null") as Partial<CachedRows> | null;
    if (!p || typeof p !== "object" || typeof p.ts !== "number" || !Array.isArray(p.rows)) return null;
    if (now - p.ts > ROWS_MAX_AGE_MS || now < p.ts) return null;
    // Shape-checked rather than trusted: a row missing its id would render
    // as a blank line that cannot be opened.
    const rows = p.rows.filter((r): r is ThreadRow =>
      !!r && typeof r === "object" && typeof (r as ThreadRow).id === "string" && typeof (r as ThreadRow).from === "string");
    if (rows.length === 0) return null;
    return { rows, page: typeof p.page === "number" ? p.page : rows.length, ts: p.ts };
  } catch {
    return null;
  }
}

export function saveRows(
  rows: readonly ThreadRow[],
  page: number,
  now = Date.now(),
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try { storage.setItem(ROWS_KEY, JSON.stringify({ rows, page, ts: now })); } catch { /* private mode */ }
}

/**
 * Mirror the rows on screen into the cache WITHOUT touching the timestamp.
 *
 * Archiving, trashing and closing out all edit the list in place, and a
 * cache that missed those would hand back mail he has already dealt with.
 * The timestamp stays put because none of it was a fresh READ: the next
 * expiry is still owed.
 */
export function mirrorRows(
  rows: readonly ThreadRow[],
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const cur = loadRows(now, storage);
  if (!cur) return;
  try { storage.setItem(ROWS_KEY, JSON.stringify({ rows, page: cur.page, ts: cur.ts })); } catch { /* private mode */ }
}

export function clearRows(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try { storage.removeItem(ROWS_KEY); } catch { /* private mode */ }
}

// ---------------------------------------------------------------------------
// When each pass last ran
// ---------------------------------------------------------------------------

export function loadReads(storage: Pick<Storage, "getItem"> = localStorage): Reads {
  try {
    const p = JSON.parse(storage.getItem(READS_KEY) || "{}") as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: Reads = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof v === "number" && k in FRESH_MS) out[k as ReadKind] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function markRead(
  kind: ReadKind,
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const all = loadReads(storage);
  all[kind] = now;
  try { storage.setItem(READS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

/**
 * Is this pass's last answer still good?
 *
 * False whenever there is no record, whenever the clock has gone backwards,
 * and always for a forced read, so the only way to skip work is to have
 * genuinely done it recently.
 */
export function isFresh(
  kind: ReadKind,
  now = Date.now(),
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  const at = loadReads(storage)[kind];
  if (typeof at !== "number") return false;
  const age = now - at;
  return age >= 0 && age < FRESH_MS[kind];
}

/** A write changed the inbox, so what was read about it is no longer good.
 *  Deliberately blunt: correctness beats a saved request every time. */
export function invalidate(
  kinds: readonly ReadKind[] = ["threads", "drafts", "waiting", "sweep", "meetings"],
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const all = loadReads(storage);
  for (const k of kinds) delete all[k];
  try { storage.setItem(READS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}
