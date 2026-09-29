import type { GoogleApi } from "../connections/google/api";
import { HistoryExpiredError } from "../connections/google/api";
import { mapThread, type ThreadRow } from "../connections/google/map";
import type { AIService } from "../ai/AIService";
import { isBudgetError } from "../ai/aiBudget";
import { aiFailureLine } from "../ai/failureLine";
import { loadAccount, saveAccount, type AccountCache, type ThreadMark } from "./mailCache";
import { mailAccountKey, type MailScope } from "./mailIdentity";
import {
  buildTriageInput, parseTriage, fillSkipped, triageDelta, loadTriageFor, saveTriageFor,
  triageRetryAfter, setTriageRetryAfter, TRIAGE_SCHEMA, FALLBACK_MAX_TRIES, type TriageMap,
} from "./triage";

// ONE PLACE THAT READS THE INBOX (2026-09-29).
//
// Before this, three things each read the mailbox their own way: the Email tab
// (list, then 30 metadata gets, then triage), the home snapshot (its own list
// and its own triage), and the four-hour pump (which calls the snapshot). A
// tab visit and a pump tick in the same minute both paid in full, and
// "nothing changed" was not something any of them could say: the only move
// once a cache went stale was to read everything again.
//
// Now both ask this module, and it asks Gmail the cheap question first:
//
//   1. the list, as REFS (thread id and Gmail's own history id for the thread,
//      nothing else): one small request, however big the window,
//   2. Gmail history since the last checkpoint: what changed anywhere,
//   3. metadata for ONLY the threads that changed or are new.
//
// Nothing changed means two small requests, no thread reads, no AI. One new
// reply means one thread read and one thread analysed.
//
// Laws:
//   - A FAILURE ADVANCES NOTHING. Not the checkpoint, not a timestamp, not
//     "complete". The stale rows stay on screen and the failure is reported.
//   - A FAILED READ IS NEVER SWALLOWED. A metadata fetch that errors fails the
//     refresh; it does not quietly leave a thread out and call the page done.
//   - HISTORY IDS ARE STRINGS. They outgrow what a number holds exactly.
//   - LABEL-ONLY CHANGES COST NO AI. Read/unread and archive move the row, not
//     the content revision, so nothing is re-analysed for them.
//   - TWO CALLERS, ONE READ. A refresh already in flight for an account is
//     joined, not repeated.
//   - THIS NEVER FETCHES A BODY, and never spends on analysis it was not asked
//     for: analysis is its own explicit step (ensureThreadAnalysis).

export const MAIL_PAGE = 30;
/** Gmail returns at most 500 per list; refs are tiny, so ask for a lot. */
const REF_PAGE_MAX = 100;
/** Concurrent metadata reads. Gmail's per-user limits punish bursts. */
export const HYDRATE_CONCURRENCY = 4;
/** More history than this is cheaper to answer by re-reading the window. */
const MAX_HISTORY_PAGES = 40;

// ---------------------------------------------------------------------------
// Single flight
// ---------------------------------------------------------------------------

const flights = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` once per key at a time. A second caller with the same key while
 * the first is running gets the SAME promise. A component ref cannot do this:
 * the tab remounts, the pump is not a component, and a ref dies with either.
 * (Cross-tab is not covered: a second browser tab has its own module, and
 * Gmail's history makes its refresh cheap anyway.)
 */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = flights.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = fn().finally(() => { if (flights.get(key) === p) flights.delete(key); });
  flights.set(key, p);
  return p;
}

/** For tests: forget every in-flight promise. */
export function resetInboxRefreshState(): void {
  flights.clear();
  overlays.clear();
}

// ---------------------------------------------------------------------------
// Mutation overlay
// ---------------------------------------------------------------------------
//
// A refresh that began BEFORE an archive or a trash can finish AFTER it and
// put the thread back. The overlay remembers what was just dealt with, and a
// refresh that started earlier than the mark drops those rows on the way out.

const OVERLAY_TTL_MS = 10 * 60e3;
const overlays = new Map<string, Map<string, number>>();

/** These threads were archived or trashed just now; keep them out of any read that began earlier. */
export function markGone(scope: MailScope, threadIds: readonly string[], now = Date.now()): void {
  const k = mailAccountKey(scope);
  const m = overlays.get(k) ?? new Map<string, number>();
  for (const id of threadIds) m.set(id, now);
  overlays.set(k, m);
}

/** Undo: the threads are back, so no overlay may hide them. */
export function unmarkGone(scope: MailScope, threadIds: readonly string[]): void {
  const m = overlays.get(mailAccountKey(scope));
  if (m) for (const id of threadIds) m.delete(id);
}

function withoutGone(scope: MailScope, rows: ThreadRow[], startedAt: number, now: number): ThreadRow[] {
  const k = mailAccountKey(scope);
  const m = overlays.get(k);
  if (!m || m.size === 0) return rows;
  for (const [id, at] of m) if (now - at > OVERLAY_TTL_MS) m.delete(id);
  // Only a mark made at or after this read began can be contradicted by it.
  return rows.filter((r) => {
    const at = m.get(r.id);
    return at === undefined || at < startedAt;
  });
}

// ---------------------------------------------------------------------------
// The refresh
// ---------------------------------------------------------------------------

export type RefreshReason = "mount" | "manual" | "pump" | "write" | "loadMore";

export interface RefreshDeps {
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** False when the owner signed out or changed while this ran: nothing is written. */
  isCurrent?: () => boolean;
}

export interface RefreshResult {
  ok: boolean;
  /** This account's window. On failure, what was cached (stale, but his). */
  rows: ThreadRow[];
  /** Rows that are new or whose content revision moved: what needs analysing. */
  changed: ThreadRow[];
  removedIds: string[];
  /** Metadata reads this call made (the number the cost tests watch). */
  hydrated: number;
  /** True when there was no checkpoint and the window was read from scratch. */
  bootstrapped: boolean;
  /** True when Gmail no longer held our checkpoint and the window was re-read. */
  resynced: boolean;
  /** True when this call joined a refresh that was already running. */
  joined: boolean;
  /** True when the whole inbox is in `rows` (the cursor ran out). */
  complete: boolean;
  nextPageToken?: string;
  stale: boolean;
  error?: unknown;
}

/**
 * Brings one account's cached inbox window up to date and returns it.
 *
 * `want` is how many threads the window covers (default: what it covered
 * last time, at least a page). Joined per account and window size.
 */
export function refreshInboxAccount(
  scope: MailScope,
  api: GoogleApi,
  opts: { reason?: RefreshReason; want?: number } & RefreshDeps = {},
): Promise<RefreshResult> {
  const key = `${mailAccountKey(scope)}#${opts.want ?? "auto"}`;
  let ran = false;
  const p = singleFlight(key, () => { ran = true; return runRefresh(scope, api, opts); });
  return p.then((r) => (ran ? r : { ...r, joined: true }));
}

/** Refreshes every connected account in parallel. One failing does not fail the rest. */
export function refreshInboxAccounts(
  userId: string,
  accounts: readonly { email: string; api: GoogleApi }[],
  opts: { reason?: RefreshReason; want?: number } & RefreshDeps = {},
): Promise<{ email: string; result: RefreshResult }[]> {
  return Promise.all(accounts.map(async ({ email, api }) => ({
    email, result: await refreshInboxAccount({ userId, account: email }, api, opts),
  })));
}

async function runRefresh(
  scope: MailScope,
  api: GoogleApi,
  opts: { reason?: RefreshReason; want?: number } & RefreshDeps,
): Promise<RefreshResult> {
  const clock = opts.now ?? Date.now;
  const startedAt = clock();
  const storage = opts.storage ?? localStorage;
  const cached = loadAccount(scope, startedAt, storage);
  const want = Math.max(opts.want ?? cached?.page ?? 0, MAIL_PAGE);
  const cachedRows = new Map((cached?.rows ?? []).map((r) => [r.id, r]));
  let hydrated = 0;
  const base: RefreshResult = {
    ok: false, rows: cached?.rows ?? [], changed: [], removedIds: [], hydrated: 0,
    bootstrapped: false, resynced: false, joined: false, complete: cached?.complete ?? false,
    ...(cached?.nextPageToken ? { nextPageToken: cached.nextPageToken } : {}),
    stale: true,
  };

  try {
    // 1. The cheap list.
    const listed = await listRefsUpTo(api, want);

    // 2. What changed since the checkpoint, or a boundary to start from.
    let checkpoint = cached?.historyId;
    let dirty = new Set<string>();
    let bootstrapped = false;
    let resynced = false;
    let boundary: string | undefined;
    if (checkpoint) {
      try {
        const h = await readAllHistory(api, checkpoint);
        dirty = h.threadIds;
        checkpoint = h.historyId ?? checkpoint;
      } catch (e) {
        if (!(e instanceof HistoryExpiredError)) throw e;
        // Gmail forgot our checkpoint (about a week). Re-read the window's
        // metadata; the analysis cache is untouched, so only threads whose
        // content actually moved are analysed again.
        resynced = true;
        boundary = (await api.getProfile()).historyId;
      }
    } else {
      bootstrapped = true;
      boundary = (await api.getProfile()).historyId;
    }

    // 3. Hydrate only what needs it.
    const fresh = new Map<string, ThreadRow>();
    const marks: Record<string, ThreadMark> = {};
    const needs: { id: string; h: string }[] = [];
    for (const ref of listed.refs) {
      const row = cachedRows.get(ref.id);
      const mark = cached?.marks[ref.id];
      const unchanged = !!row && !!mark && !bootstrapped && !resynced && !dirty.has(ref.id) && !!ref.historyId && mark.h === ref.historyId;
      if (unchanged) { fresh.set(ref.id, row!); marks[ref.id] = mark!; }
      else needs.push({ id: ref.id, h: ref.historyId });
    }
    const read = async (id: string, h: string) => {
      hydrated++;
      const meta = await api.getThreadMeta(id);
      const row = meta ? mapThread(meta) : null;
      // Gone, or no longer in the inbox: it leaves the window, it is not an error.
      if (row && row.inInbox) {
        fresh.set(id, { ...row, account: scope.account });
        marks[id] = { h, rev: row.lastMsgId };
      }
    };
    await pool(needs, HYDRATE_CONCURRENCY, (n) => read(n.id, n.h));

    // Bootstrap and resync have no trustworthy checkpoint until the window is
    // read: replay everything since the boundary, so a change that landed
    // while the window was being read is not lost.
    if (boundary !== undefined) {
      const replay = await readAllHistory(api, boundary);
      const inWindow = replay.threadIds;
      const again = listed.refs.filter((r) => inWindow.has(r.id) && !needs.some((n) => n.id === r.id));
      await pool(again, HYDRATE_CONCURRENCY, (r) => read(r.id, r.historyId));
      checkpoint = replay.historyId ?? boundary;
    }

    if (opts.isCurrent && !opts.isCurrent()) {
      return { ...base, error: new Error("The signed-in account changed while mail was loading") };
    }

    // 4. Assemble, in the order the screen wants.
    const now = clock();
    let rows = listed.refs.map((r) => fresh.get(r.id)).filter((r): r is ThreadRow => !!r)
      .sort((a, b) => b.dateMs - a.dateMs);
    rows = withoutGone(scope, rows, startedAt, now);
    const changed = rows.filter((r) => cached?.marks[r.id]?.rev !== r.lastMsgId || !cachedRows.has(r.id));
    const kept = new Set(rows.map((r) => r.id));
    const removedIds = [...cachedRows.keys()].filter((id) => !kept.has(id));
    const finalMarks: Record<string, ThreadMark> = {};
    for (const r of rows) finalMarks[r.id] = marks[r.id] ?? { h: "", rev: r.lastMsgId };

    // 5. Persist LAST, and only on full success.
    saveAccount(scope, {
      rows, marks: finalMarks,
      ...(checkpoint ? { historyId: checkpoint } : {}),
      checkedAt: now,
      updatedAt: changed.length > 0 || removedIds.length > 0 ? now : (cached?.updatedAt ?? now),
      page: want,
      ...(listed.nextPageToken ? { nextPageToken: listed.nextPageToken } : {}),
      complete: !listed.nextPageToken,
      reads: cached?.reads ?? {},
    }, storage);

    return {
      ok: true, rows, changed, removedIds, hydrated, bootstrapped, resynced, joined: false,
      complete: !listed.nextPageToken, ...(listed.nextPageToken ? { nextPageToken: listed.nextPageToken } : {}),
      stale: false,
    };
  } catch (error) {
    // Nothing was written, so nothing advanced. The stale window is returned
    // as it was, marked stale, with the reason.
    return { ...base, hydrated, error };
  }
}

/** The window's refs, following Gmail's cursor until `want` are collected or it ends. */
async function listRefsUpTo(api: GoogleApi, want: number): Promise<{ refs: { id: string; historyId: string }[]; nextPageToken?: string }> {
  const refs: { id: string; historyId: string }[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  for (;;) {
    const page = await api.listInboxThreadRefs(Math.min(REF_PAGE_MAX, want - refs.length), token);
    for (const r of page.refs) if (!seen.has(r.id)) { seen.add(r.id); refs.push(r); }
    token = page.nextPageToken;
    if (!token || refs.length >= want) break;
  }
  return { refs: refs.slice(0, want), ...(token ? { nextPageToken: token } : {}) };
}

/** Every history page since `startHistoryId`, deduplicated, with the newest checkpoint. */
async function readAllHistory(api: GoogleApi, startHistoryId: string): Promise<{ threadIds: Set<string>; historyId?: string }> {
  const ids = new Set<string>();
  let historyId: string | undefined;
  let token: string | undefined;
  for (let pages = 0; ; pages++) {
    if (pages >= MAX_HISTORY_PAGES) throw new HistoryExpiredError(); // too much to replay: re-read the window
    const page = await api.listHistory(startHistoryId, token);
    for (const id of page.threadIds) ids.add(id);
    if (page.historyId) historyId = page.historyId;
    token = page.nextPageToken;
    if (!token) break;
  }
  return { threadIds: ids, ...(historyId ? { historyId } : {}) };
}

/** Runs `fn` over `items` with at most `n` in flight; the first failure rejects and stops new work. */
export async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  let failed: unknown;
  let hasFailed = false;
  const worker = async () => {
    while (!hasFailed) {
      const at = i++;
      if (at >= items.length) return;
      try { await fn(items[at]!); } catch (e) { hasFailed = true; failed = e; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  if (hasFailed) throw failed;
}

// ---------------------------------------------------------------------------
// Load More: follow the cursor
// ---------------------------------------------------------------------------

/**
 * The next page of the inbox, from the cursor the last read ended on. Earlier
 * pages are not listed or read again. Falls back to a wider refresh when the
 * cached cursor is missing or Gmail no longer honours it.
 */
export async function loadMoreInbox(
  scope: MailScope,
  api: GoogleApi,
  add: number = MAIL_PAGE,
  deps: RefreshDeps = {},
): Promise<RefreshResult> {
  const clock = deps.now ?? Date.now;
  const storage = deps.storage ?? localStorage;
  const cached = loadAccount(scope, clock(), storage);
  if (!cached || !cached.nextPageToken) {
    return refreshInboxAccount(scope, api, { reason: "loadMore", want: (cached?.page ?? MAIL_PAGE) + add, ...deps });
  }
  return singleFlight(`${mailAccountKey(scope)}#more`, async () => {
    let hydrated = 0;
    try {
      const page = await api.listInboxThreadRefs(add, cached.nextPageToken);
      const have = new Set(cached.rows.map((r) => r.id));
      const fresh = page.refs.filter((r) => !have.has(r.id));
      const got: ThreadRow[] = [];
      const marks = { ...cached.marks };
      await pool(fresh, HYDRATE_CONCURRENCY, async (ref) => {
        hydrated++;
        const meta = await api.getThreadMeta(ref.id);
        const row = meta ? mapThread(meta) : null;
        if (row && row.inInbox) { got.push({ ...row, account: scope.account }); marks[ref.id] = { h: ref.historyId, rev: row.lastMsgId }; }
      });
      if (deps.isCurrent && !deps.isCurrent()) throw new Error("The signed-in account changed while mail was loading");
      const rows = [...cached.rows, ...got.sort((a, b) => b.dateMs - a.dateMs)];
      // The cursor moved and the window grew. The checkpoint and checkedAt
      // did not: nothing here re-verified the earlier pages.
      const { nextPageToken: _spent, ...rest } = cached;
      saveAccount(scope, {
        ...rest, rows, marks,
        page: cached.page + add,
        ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
        complete: !page.nextPageToken,
      }, storage);
      return {
        ok: true, rows, changed: got, removedIds: [], hydrated, bootstrapped: false, resynced: false, joined: false,
        complete: !page.nextPageToken, ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}), stale: false,
      } satisfies RefreshResult;
    } catch {
      // A stale or rejected cursor is the ordinary way this fails: widen instead.
      return refreshInboxAccount(scope, api, { reason: "loadMore", want: cached.page + add, ...deps });
    }
  });
}

// ---------------------------------------------------------------------------
// Analysis: what the model is asked, and when
// ---------------------------------------------------------------------------

export const TRIAGE_BATCH = 12;
export const TRIAGE_TIMEOUT_MS = 20000;
/** The proxy refuses a request over 32 KiB; stay well under it. */
const MAX_BATCH_CHARS = 24000;
/** How long a failed analysis waits before the same threads are offered again. */
export const ANALYSIS_COOLDOWN_MS = 10 * 60e3;

export interface AnalysisDeps {
  ai: AIService;
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** The person tapped Try Again: ignore the cooldown and offer fallbacks again. */
  force?: boolean;
  /** Per-request ceiling. Only tests change it. */
  timeoutMs?: number;
  onProgress?: (p: { done: number; total: number }) => void;
  /** Called with the account's whole map after each batch lands. */
  onBatch?: (map: TriageMap) => void;
  isCurrent?: () => boolean;
}

export type AnalysisStatus = "idle" | "ok" | "partial" | "failed" | "unavailable" | "budget" | "auth" | "cooldown";

export interface AnalysisResult {
  status: AnalysisStatus;
  /** Threads the model answered in this call. */
  analysed: number;
  /** Threads left as a fallback because their batch failed. */
  failed: number;
  /** Requests sent (the paid-call counter the cost tests watch). */
  requests: number;
  message?: string;
  map: TriageMap;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, reject) => { t = setTimeout(() => reject(new TimeoutError()), ms); }),
  ]);
}
class TimeoutError extends Error { constructor() { super("Sorting took too long."); } }

/** Splits a batch until each request fits, never past one thread. */
export function splitForSize(rows: ThreadRow[], maxChars = MAX_BATCH_CHARS): ThreadRow[][] {
  if (rows.length <= 1 || buildTriageInput(rows).length <= maxChars) return [rows];
  const mid = Math.ceil(rows.length / 2);
  return [...splitForSize(rows.slice(0, mid), maxChars), ...splitForSize(rows.slice(mid), maxChars)];
}

/**
 * Analyses the threads of one account that have no answer for their CURRENT
 * content, in batches of at most 12 and never over the request size limit.
 * Threads already answered for their latest message cost nothing.
 *
 * Only what is asked for is analysed: pass the rows on screen or the rows a
 * refresh reported as changed. A thread whose label changed is not in either
 * list. Joined per account, so the tab and the pump never ask twice.
 *
 * What stops it: a budget refusal or an auth refusal ends the whole call (a
 * second batch would be refused the same way). A batch that times out is NOT
 * re-sent, because the first request may still be running and be billed; its
 * threads are left as visible fallbacks and offered again after a cooldown,
 * a bounded number of times.
 */
export function ensureThreadAnalysis(
  scope: MailScope,
  rows: readonly ThreadRow[],
  deps: AnalysisDeps,
): Promise<AnalysisResult> {
  return singleFlight(`triage#${mailAccountKey(scope)}`, () => runAnalysis(scope, rows, deps));
}

async function runAnalysis(scope: MailScope, rows: readonly ThreadRow[], deps: AnalysisDeps): Promise<AnalysisResult> {
  const clock = deps.now ?? Date.now;
  const storage = deps.storage ?? localStorage;
  const cache = loadTriageFor(scope, storage);
  const retryDue = deps.force === true || clock() >= triageRetryAfter(scope, storage);
  const delta = triageDelta([...rows], cache, { retryFallback: retryDue });
  const out = (status: AnalysisStatus, analysed = 0, failed = 0, requests = 0, message?: string, map = cache): AnalysisResult =>
    ({ status, analysed, failed, requests, ...(message ? { message } : {}), map });

  if (delta.length === 0) {
    // Nothing to ask. If the only things left are fallbacks waiting out their
    // cooldown, say so rather than "idle": the screen may want to offer Try Again.
    const cooling = !retryDue && [...rows].some((r) => {
      const e = cache[r.id];
      return !!e && e.fallback === true && e.lastMsgId === r.lastMsgId && (e.tries ?? 1) < FALLBACK_MAX_TRIES;
    });
    return out(cooling ? "cooldown" : "idle");
  }
  if (!deps.ai.available) return out("unavailable");
  // AFTER A FAILURE, ASK NOTHING FOR A WHILE. This is what keeps a refused or
  // failing sort from becoming a retry storm: every visit, every pump tick
  // and every remount finds the cooldown and returns without a request. Only
  // an explicit Try Again (force) goes around it, and a cooldown that has
  // passed lets the next call through.
  if (!retryDue) return out("cooldown");

  let merged: TriageMap = { ...cache };
  let analysed = 0;
  let failed = 0;
  let requests = 0;
  let done = 0;
  let stop: AnalysisStatus | null = null;
  let message = "";
  deps.onProgress?.({ done: 0, total: delta.length });

  // At most TRIAGE_BATCH per request, each also under the size cap.
  const batches: ThreadRow[][] = [];
  for (let i = 0; i < delta.length; i += TRIAGE_BATCH) batches.push(...splitForSize(delta.slice(i, i + TRIAGE_BATCH)));

  for (const batch of batches) {
    // After a refusal the rest are NOT sent, and NOT filled: they were never
    // attempted, so they stay unanswered and are offered again when the limit
    // or the sign-in changes.
    if (stop) { failed += batch.length; continue; }
    if (deps.isCurrent && !deps.isCurrent()) { stop = "failed"; failed += batch.length; continue; }
    let parsed: TriageMap | null = null;
    // One repeat, and only for a reply that arrived but could not be read.
    // A timeout, a network error, a refusal: never re-sent.
    for (let attempt = 0; attempt < 2 && !parsed && !stop; attempt++) {
      try {
        requests++;
        const raw = await withTimeout(
          deps.ai.complete(
            [{ role: "user", content: buildTriageInput(batch) }],
            "You output only a JSON array, nothing else.",
            { kind: "triage", schema: TRIAGE_SCHEMA },
          ),
          deps.timeoutMs ?? TRIAGE_TIMEOUT_MS,
        );
        parsed = parseTriage(raw, batch);
        if (!parsed) message = "Sort came back unreadable";
      } catch (e) {
        if (isBudgetError(e)) { stop = "budget"; message = e.message; }
        else if (/\((401|403)\)/.test(e instanceof Error ? e.message : "")) { stop = "auth"; message = aiFailureLine(e, "The sort didn't come back"); }
        else { message = aiFailureLine(e, "The sort didn't come back"); break; }
      }
    }
    done += batch.length;
    deps.onProgress?.({ done: Math.min(done, delta.length), total: delta.length });
    if (!parsed) { failed += batch.length; merged = fillSkipped(merged, batch); continue; }
    // What the model answered is real; what it skipped is a visible fallback.
    const answered = Object.keys(parsed).length;
    analysed += answered;
    failed += batch.length - answered;
    merged = fillSkipped({ ...merged, ...parsed }, batch);
    saveTriageFor(scope, merged, storage); // cached the moment it lands
    deps.onBatch?.(merged);
  }

  saveTriageFor(scope, merged, storage);
  // A failure means these threads are not offered again straight away.
  if (failed > 0) setTriageRetryAfter(scope, clock() + ANALYSIS_COOLDOWN_MS, storage);
  else setTriageRetryAfter(scope, null, storage);
  // onBatch is called only as a batch LANDS (above), never here: this is also
  // the path a total failure takes, and a caller must not be told "here is a
  // sort" about a call that produced none.

  const status: AnalysisStatus = stop ?? (analysed === 0 ? "failed" : failed > 0 ? "partial" : "ok");
  return out(status, analysed, failed, requests, message || undefined, merged);
}
