import type { ThreadRow } from "../connections/google/map";
import { mailAccountKey, type MailScope } from "./mailIdentity";

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
// Triage was the one pass already cached, which is why the AI spend never
// looked alarming while the Gmail spend quietly did.
//
// This module is the missing half: the rows themselves, kept so a remount
// paints instantly, and one timestamp per expensive pass so the pass is
// skipped while its last answer is still good.
//
// 2026-09-29, the second cut. The first one was one global row list and one
// global clock, which broke in four ways:
//   1. It was not scoped. Two Google accounts overwrote each other's rows,
//      and a second sign-in on the same phone could read the first person's
//      mail. Every entry is now keyed by owner AND account (mailIdentity.ts).
//   2. An empty inbox was refused: loadRows returned null for zero rows, so
//      a genuinely empty inbox re-read on every visit. [] is a valid answer.
//   3. It could not say what had CHANGED. It kept rows and a time, so once
//      stale the only move was to read everything again. It now keeps Gmail's
//      history checkpoint and a per-thread mark, so a refresh asks "what
//      changed since?" and hydrates only that.
//   4. Its clocks could advance on a read that failed. A clock is set only
//      by the caller that finished the pass, and a failed refresh writes
//      nothing at all: not a timestamp, not a checkpoint, not "complete".
//
// Laws:
//   - CACHED MAIL IS STILL HIS MAIL. A stale read paints immediately and
//     refreshes behind it; the screen never blanks to spare a request.
//   - A DELIBERATE REFRESH ALWAYS WINS. Pull, Load More, Try Again and any
//     write that changes the inbox force the read regardless of freshness.
//   - NOTHING HERE IS A DECISION. It only says what was last read and when.
//   - A FAILURE ADVANCES NOTHING. Stale data stays visible and honest.
//   - STORAGE THAT FAILS DOES NOT COST A RE-READ. When the phone refuses the
//     write (quota, private mode) the entry lives in memory for the life of
//     the app, so a remount finds it instead of spending the requests again.

export const CACHE_SCHEMA = 2;
// Exported for the unified Email tab's own device cache (email/deviceCache.ts,
// slice 05), which keeps its keys under this prefix so clearAllMailCache and
// clearOwnerMailCache take them with the rest.
export const ACCOUNT_PREFIX = "jarvis.mail.acct.v2:";
// The pre-scoping keys. Their owner and account cannot be proven (one global
// row list, no user id), so they are dropped rather than guessed at.
const LEGACY_KEYS = ["jarvis.mail.rows.v1", "jarvis.mail.reads.v1"];

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

/** What is remembered about one thread besides its row. */
export interface ThreadMark {
  /** Gmail's history id for the thread when it was last hydrated. A string. */
  h: string;
  /** Content revision: the latest message id. New or deleted mail moves it,
   *  a label change does not, so only content triggers analysis. */
  rev: string;
}

export interface AccountCache {
  v: typeof CACHE_SCHEMA;
  /** The inbox window as last verified. [] is a real answer. */
  rows: ThreadRow[];
  marks: Record<string, ThreadMark>;
  /** Gmail history checkpoint: everything up to here is reflected in rows. */
  historyId?: string;
  /** Last time a refresh COMPLETED (list and history both answered). */
  checkedAt: number;
  /** Last time the content of any thread actually changed. */
  updatedAt: number;
  /** How many threads the window covers, so Load More resumes there. */
  page: number;
  /** The cursor at the end of the window, when there is more inbox. */
  nextPageToken?: string;
  /** True only when the cursor was exhausted: this is the whole inbox. */
  complete: boolean;
  /** Per satellite pass: when it finished and against which content. */
  reads: Partial<Record<ReadKind, { at: number; rev: string }>>;
}

export interface CachedRows {
  rows: ThreadRow[];
  /** The page size the rows were read at, so Load More resumes there. */
  page: number;
  ts: number;
}

type Store = Pick<Storage, "getItem" | "setItem">;

// The FALLBACK memory: an entry lives here only when the phone refused its
// durable write (quota, private mode). A remount finds it, so the requests are
// not spent again; and because a successful write removes it, this never
// shadows what storage holds in the ordinary case. One map per storage
// object, so a test's private storage and the real one never share entries.
const memories = new WeakMap<object, Map<string, string>>();
function memoryFor(storage: object): Map<string, string> {
  let m = memories.get(storage);
  if (!m) { m = new Map(); memories.set(storage, m); }
  return m;
}

const keyOf = (scope: MailScope) => ACCOUNT_PREFIX + mailAccountKey(scope);

function readRaw(storage: Pick<Storage, "getItem">, key: string): string | null {
  const mem = memoryFor(storage).get(key);
  if (mem !== undefined) return mem;
  try { return storage.getItem(key); } catch { return null; }
}

function writeRaw(storage: Store, key: string, value: string): void {
  try {
    storage.setItem(key, value);
    memoryFor(storage).delete(key);
  } catch {
    // Quota or private mode: memory has it for the life of the app.
    memoryFor(storage).set(key, value);
  }
}

const isStr = (v: unknown): v is string => typeof v === "string";

function parseAccount(raw: string | null): AccountCache | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<AccountCache> | null;
    if (!p || typeof p !== "object" || p.v !== CACHE_SCHEMA) return null;
    if (!Array.isArray(p.rows) || typeof p.checkedAt !== "number") return null;
    // Shape-checked rather than trusted: a row missing its id would render
    // as a blank line that cannot be opened.
    const rows = p.rows.filter((r): r is ThreadRow =>
      !!r && typeof r === "object" && isStr((r as ThreadRow).id) && isStr((r as ThreadRow).from));
    const marks: Record<string, ThreadMark> = {};
    if (p.marks && typeof p.marks === "object" && !Array.isArray(p.marks)) {
      for (const [id, m] of Object.entries(p.marks)) {
        if (m && typeof m === "object" && isStr((m as ThreadMark).h) && isStr((m as ThreadMark).rev)) marks[id] = m;
      }
    }
    const reads: AccountCache["reads"] = {};
    if (p.reads && typeof p.reads === "object" && !Array.isArray(p.reads)) {
      for (const [k, v] of Object.entries(p.reads)) {
        if (k in FRESH_MS && v && typeof v === "object" && typeof (v as { at: unknown }).at === "number") {
          reads[k as ReadKind] = { at: (v as { at: number }).at, rev: isStr((v as { rev: unknown }).rev) ? (v as { rev: string }).rev : "" };
        }
      }
    }
    return {
      v: CACHE_SCHEMA, rows, marks,
      ...(isStr(p.historyId) && p.historyId ? { historyId: p.historyId } : {}),
      checkedAt: p.checkedAt,
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : p.checkedAt,
      page: typeof p.page === "number" ? p.page : rows.length,
      ...(isStr(p.nextPageToken) && p.nextPageToken ? { nextPageToken: p.nextPageToken } : {}),
      complete: p.complete === true,
      reads,
    };
  } catch {
    return null; // one corrupt account never takes another down with it
  }
}

// ---------------------------------------------------------------------------
// The account envelope
// ---------------------------------------------------------------------------

/** Everything remembered about one account, or null. A timestamp from the
 *  future is not trusted (the clock moved, or the entry is not ours). */
export function loadAccount(scope: MailScope, now = Date.now(), storage: Store = localStorage): AccountCache | null {
  const c = parseAccount(readRaw(storage, keyOf(scope)));
  if (!c || c.checkedAt > now) return null;
  return c;
}

export function saveAccount(scope: MailScope, cache: Omit<AccountCache, "v">, storage: Store = localStorage): void {
  writeRaw(storage, keyOf(scope), JSON.stringify({ v: CACHE_SCHEMA, ...cache }));
}

// ---------------------------------------------------------------------------
// The rows
// ---------------------------------------------------------------------------

export function loadRows(scope: MailScope, now = Date.now(), storage: Store = localStorage): CachedRows | null {
  const c = loadAccount(scope, now, storage);
  if (!c || now - c.checkedAt > ROWS_MAX_AGE_MS) return null;
  // An empty inbox is a valid, cached answer: [] paints "Inbox Is Quiet"
  // without a request. It used to read as "nothing cached" and re-read every
  // visit.
  return { rows: c.rows, page: c.page, ts: c.checkedAt };
}

export function saveRows(
  scope: MailScope,
  rows: readonly ThreadRow[],
  page: number,
  now = Date.now(),
  storage: Store = localStorage,
): void {
  const cur = loadAccount(scope, Number.MAX_SAFE_INTEGER, storage);
  const marks: Record<string, ThreadMark> = {};
  for (const r of rows) marks[r.id] = cur?.marks[r.id] ?? { h: "", rev: r.lastMsgId };
  saveAccount(scope, {
    rows: [...rows], marks,
    ...(cur?.historyId ? { historyId: cur.historyId } : {}),
    checkedAt: now, updatedAt: now, page,
    ...(cur?.nextPageToken ? { nextPageToken: cur.nextPageToken } : {}),
    complete: cur?.complete ?? false,
    reads: cur?.reads ?? {},
  }, storage);
}

/**
 * Mirror the rows on screen into the cache WITHOUT touching any timestamp.
 *
 * Archiving, trashing and closing out all edit the list in place, and a
 * cache that missed those would hand back mail he has already dealt with.
 * The timestamp stays put because none of it was a fresh READ: the next
 * expiry is still owed. Persisting [] after the last row is dealt with is
 * the point of the empty-cache fix: the emptied inbox stays emptied.
 */
export function mirrorRows(
  scope: MailScope,
  rows: readonly ThreadRow[],
  now = Date.now(),
  storage: Store = localStorage,
): void {
  const cur = loadAccount(scope, now, storage);
  if (!cur) return;
  const keep = new Set(rows.map((r) => r.id));
  const marks: Record<string, ThreadMark> = {};
  for (const [id, m] of Object.entries(cur.marks)) if (keep.has(id)) marks[id] = m;
  saveAccount(scope, { ...cur, rows: [...rows], marks }, storage);
}

export function clearRows(scope: MailScope, storage: Pick<Storage, "removeItem"> & Store = localStorage): void {
  memoryFor(storage).delete(keyOf(scope));
  try { storage.removeItem(keyOf(scope)); } catch { /* private mode */ }
}

/**
 * Everything this device remembers about anyone's mail: every account of
 * every owner, plus the pre-scoping keys. For sign-out and Clear Local Data,
 * where "whose" no longer matters because all of it goes.
 */
export function clearAllMailCache(storage: Pick<Storage, "removeItem"> & Partial<Pick<Storage, "length" | "key">> = localStorage): void {
  const mem = memoryFor(storage);
  for (const k of [...mem.keys()]) if (k.startsWith(ACCOUNT_PREFIX)) mem.delete(k);
  try {
    const doomed: string[] = [...LEGACY_KEYS];
    // A storage that can be enumerated has every account key found and
    // removed; one that cannot (a minimal test double) still loses the rest.
    if (typeof storage.length === "number" && typeof storage.key === "function") {
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(ACCOUNT_PREFIX)) doomed.push(k);
      }
    }
    for (const k of doomed) storage.removeItem(k);
  } catch { /* private mode */ }
}

/** One owner's mail, when an account is removed or they sign out. */
export function clearOwnerMailCache(userId: string, storage: Storage = localStorage): void {
  // An account key is "mail:<user>:<account>", so an empty account leaves
  // exactly the owner prefix, trailing separator and all: "u1:" never matches "u10:".
  const prefix = ACCOUNT_PREFIX + mailAccountKey({ userId, account: "" });
  const mem = memoryFor(storage);
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) mem.delete(k);
  try {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) storage.removeItem(k);
  } catch { /* private mode */ }
}

/** Drops the unscoped keys from before this cut. Safe to call every time. */
export function dropLegacyMailCache(storage: Pick<Storage, "removeItem"> = localStorage): void {
  for (const k of LEGACY_KEYS) { try { storage.removeItem(k); } catch { /* private mode */ } }
}

// ---------------------------------------------------------------------------
// When each pass last ran
// ---------------------------------------------------------------------------

export function loadReads(scope: MailScope, storage: Store = localStorage): Partial<Record<ReadKind, number>> {
  const c = loadAccount(scope, Number.MAX_SAFE_INTEGER, storage);
  const out: Partial<Record<ReadKind, number>> = {};
  if (c) for (const [k, v] of Object.entries(c.reads)) out[k as ReadKind] = v.at;
  return out;
}

/**
 * Record that a pass FINISHED. Called by the pass itself after it succeeded,
 * never before: a clock set ahead of the work is how a failed read used to
 * pass for a fresh one. A pass with no account entry yet has nowhere to
 * record itself, which reads as "never read", the safe answer.
 */
export function markRead(
  scope: MailScope,
  kind: ReadKind,
  now = Date.now(),
  storage: Store = localStorage,
  rev = "",
): void {
  const cur = loadAccount(scope, Number.MAX_SAFE_INTEGER, storage);
  if (!cur) return;
  saveAccount(scope, { ...cur, reads: { ...cur.reads, [kind]: { at: now, rev } } }, storage);
}

/**
 * Is this pass's last answer still good?
 *
 * False whenever there is no record, whenever the clock has gone backwards,
 * and always for a forced read, so the only way to skip work is to have
 * genuinely done it recently.
 */
export function isFresh(
  scope: MailScope,
  kind: ReadKind,
  now = Date.now(),
  storage: Store = localStorage,
): boolean {
  const at = loadReads(scope, storage)[kind];
  if (typeof at !== "number") return false;
  const age = now - at;
  return age >= 0 && age < FRESH_MS[kind];
}

/** A write changed the inbox, so what was read about it is no longer good.
 *  Deliberately blunt: correctness beats a saved request every time. */
export function invalidate(
  scope: MailScope,
  kinds: readonly ReadKind[] = ["threads", "drafts", "waiting", "sweep", "meetings"],
  storage: Store = localStorage,
): void {
  const cur = loadAccount(scope, Number.MAX_SAFE_INTEGER, storage);
  if (!cur) return;
  const reads = { ...cur.reads };
  for (const k of kinds) delete reads[k];
  saveAccount(scope, { ...cur, reads }, storage);
}
