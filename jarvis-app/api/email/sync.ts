// SYNC ONE MAILBOX INTO THE CACHE (docs/jarvis-unified, slice 05;
// IMPLEMENTATION-SPEC.md 08 E02, 11; Email v1 spec 2026-10-08 sections 8.1 and
// 8.3, AC39, AC40). The person pulls to refresh, or opens Email, or asks for
// the next page, and the open app keeps a crawl moving while it is not done;
// nothing here runs on its own. Three shapes of one request:
//
//   { email }                 sync: what this mailbox needs next (below).
//   { email, page }           the next page of the inbox, appended; the
//                             cursor and the freshness do not move.
//
// What { email } does, decided from the account's own sync facts (migration
// 0065, read through email_coverage_state):
//
//   - a mailbox whose 90-day window was listed and reconciled (verified, no
//     crawl open): a refresh from the cursor by Gmail's history, as before;
//     current again when the history was read to its end;
//   - otherwise (a first sync, or Gmail no longer holds the cursor): the
//     coverage crawl. Its start reads the mailbox's history clock FIRST and
//     keeps it as the checkpoint, then lists Inbox and Sent for the last 90
//     days a bounded number of pages per call, each page applied with its
//     progress in one transaction. While it runs the mailbox is catching_up
//     and its freshness does not move. When every label is listed, the
//     changes since the checkpoint are read from Gmail's history and applied,
//     and only then is the mailbox current (verified_through_at, the cursor,
//     last_sync_at). The answer says `coverage_complete` so the app knows to
//     call again.
//
// With migration 0065 not applied yet (the coverage functions answer 404), it
// does exactly what it did before: the first inbox page, or the history.
//
// Freshness advances only on a good, complete sync. A failure records its
// error and leaves the last good cache readable. Transport only: no
// extraction, no inference, no cards.
export const config = { runtime: "edge" };

import { authedUser, ensureAccount, failResponse, fail, fetchMetas, gmail, gmailFail, isEmail, json, mailboxToken, type MailboxAuth, readEnv, readBody, serviceRpc, META_FIELDS, type EmailEnv, type Fail } from "../_email";

export const INBOX_PAGE = 30;
/** The declared coverage window (8.3): Inbox and Sent, the last 90 days. */
export const COVERAGE_LABELS = ["INBOX", "SENT"] as const;
export const COVERAGE_DAYS = 90;
/** Messages listed per crawl page; each one costs a metadata read. */
export const CRAWL_PAGE = 50;
/** Crawl pages one call may apply. */
export const CRAWL_MAX_PAGES = 6;
/** No new crawl page or reconciliation starts after this much of a call has gone (the edge function answers well inside 25 s). */
export const CRAWL_BUDGET_MS = 10_000;
/** Metadata reads in flight during a crawl: gentler than a refresh's six, because a crawl reads hundreds in a row and Gmail's per-user quota is 250 units a second (5 a read). */
export const CRAWL_CONCURRENCY = 4;
/** History pages one call reads: the refresh as it always was, and the crawl's reconciliation per label. */
const HISTORY_PAGES = 20;
const RECONCILE_PAGES = 10;

interface Body extends Record<string, unknown> { email?: unknown; page?: unknown }

interface LabelProgress { next: string | null; done: boolean; listed: number }
interface Crawl { epoch: number; history_id: string; order: string[]; labels: Record<string, LabelProgress> }
interface Coverage { sync_state: string | null; sync_epoch: number; coverage_start: string | null; verified_through_at: string | null; last_sync_at: string | null; cursor: string | null; crawl: Crawl | null }

async function recordFailure(env: EmailEnv, userId: string, accountId: string, f: Fail): Promise<void> {
  await serviceRpc(env, "email_sync_failed", { p_owner: userId, p_account: accountId, p_error: f.safe_message, p_reauth: f.code === "PROVIDER_AUTH" });
}

async function listPage(token: string | MailboxAuth, pageToken?: string): Promise<{ ids: string[]; next?: string } | Fail> {
  const a = await gmail(token, `/messages?labelIds=INBOX&maxResults=${INBOX_PAGE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { safeRead: true });
  if (!a.ok) return gmailFail(a);
  const b = a.body as { messages?: { id: string }[]; nextPageToken?: string };
  return { ids: (b.messages ?? []).map((m) => m.id), ...(b.nextPageToken ? { next: b.nextPageToken } : {}) };
}

/** One crawl page of one label inside the window. The query is built from the stored window start, so a page token stays valid across calls. */
async function coveragePage(token: MailboxAuth, label: string, afterSec: number, pageToken: string | null): Promise<{ ids: string[]; next: string | null } | { fail: Fail; badToken: boolean }> {
  const a = await gmail(token, `/messages?labelIds=${label}&q=${encodeURIComponent(`after:${afterSec}`)}&maxResults=${CRAWL_PAGE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { safeRead: true });
  // Gmail refuses a page token it no longer takes with a 400; the crawl restarts rather than skip what that page held.
  if (!a.ok) return { fail: gmailFail(a), badToken: a.status === 400 && !!pageToken };
  const b = a.body as { messages?: { id: string }[]; nextPageToken?: string };
  return { ids: [...new Set((b.messages ?? []).map((m) => m.id))], next: b.nextPageToken ?? null };
}

type History = { kind: "expired" } | { kind: "fail"; fail: Fail } | { kind: "ok"; changed: Set<string>; removed: Set<string>; historyId?: string; truncated: boolean };

/** Gmail's history since a checkpoint for one label, bounded. Cut off at the bound, the caller must not move its cursor past what was read (AC40). */
async function readHistory(tok: MailboxAuth, start: string, label: string, maxPages: number): Promise<History> {
  const changed = new Set<string>();
  const removed = new Set<string>();
  let historyId: string | undefined;
  let pageToken: string | undefined;
  let truncated = false;
  for (let i = 0; i < maxPages; i++) {
    const a = await gmail(tok, `/history?startHistoryId=${encodeURIComponent(start)}&labelId=${label}&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { safeRead: true });
    if (a.status === 404) return { kind: "expired" };
    if (!a.ok) return { kind: "fail", fail: gmailFail(a) };
    const b = a.body as { history?: Array<{ messagesAdded?: Array<{ message: { id: string } }>; messagesDeleted?: Array<{ message: { id: string } }>; labelsAdded?: Array<{ message: { id: string } }>; labelsRemoved?: Array<{ message: { id: string } }> }>; historyId?: string; nextPageToken?: string };
    for (const h of b.history ?? []) {
      for (const x of h.messagesAdded ?? []) changed.add(x.message.id);
      for (const x of h.labelsAdded ?? []) changed.add(x.message.id);
      for (const x of h.labelsRemoved ?? []) changed.add(x.message.id);
      for (const x of h.messagesDeleted ?? []) { removed.add(x.message.id); changed.delete(x.message.id); }
    }
    historyId = b.historyId ?? historyId;
    pageToken = b.nextPageToken;
    if (!pageToken) break;
    // The loop is bounded. If Gmail still has pages after the last one, what was read is applied but the cursor must NOT
    // move to it, or the changes in the unread pages would be skipped for good (Email spec AC40).
    if (i === maxPages - 1) truncated = true;
  }
  return { kind: "ok", changed, removed, ...(historyId ? { historyId } : {}), truncated };
}

/** The coverage facts, or null when migration 0065 is not applied (the function is not there: PostgREST answers 404). */
async function coverageOf(env: EmailEnv, userId: string, accountId: string): Promise<Coverage | null | Fail> {
  const r = await serviceRpc(env, "email_coverage_state", { p_owner: userId, p_account: accountId });
  if (r.error) return (r.error as { status?: number }).status === 404 ? null : fail("UNAVAILABLE");
  const d = r.data as (Coverage & { error?: string }) | null;
  if (!d || d.error) return fail("UNAVAILABLE");
  return d;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);
  const body = await readBody<Body>(req);
  if (!body || !isEmail(body.email)) return failResponse(fail("INVALID_PAYLOAD"));
  const email = body.email.toLowerCase();
  const page = typeof body.page === "string" && body.page.length <= 512 ? body.page : null;

  const account = await ensureAccount(env, who.id, email);
  if ("code" in account) return failResponse(account);
  const tok = await mailboxToken(env, who.id, email);
  if (!tok.ok) { await recordFailure(env, who.id, account.id, tok.fail); return failResponse(tok.fail); }
  const failed = async (f: Fail): Promise<Response> => { await recordFailure(env, who.id, account.id, f); return failResponse(f); };

  // The next page: appended, nothing else moves.
  if (page) {
    const listed = await listPage(tok, page);
    if ("code" in listed) return failed(listed);
    const metas = await fetchMetas(tok, listed.ids);
    if (metas.failed) return failed(metas.failed);
    const applied = await serviceRpc(env, "email_sync_apply", { p_owner: who.id, p_account: account.id, p_messages: metas.rows, p_removed: metas.gone, p_cursor: null, p_advance: false });
    if (applied.error) return failed(fail("UNAVAILABLE"));
    return json({ ok: true, synced: metas.rows.length, removed: metas.gone.length, next_page: listed.next ?? null, complete: !listed.next, resynced: false });
  }

  const cov = await coverageOf(env, who.id, account.id);
  if (cov !== null && "code" in cov) return failed(cov);
  const covered = cov !== null && !cov.crawl && !!cov.verified_through_at && !!cov.cursor;
  // Before 0065 the cursor alone decides, exactly as it always did; after it, only a mailbox whose window was verified refreshes.
  const cursor = cov === null ? account.cursor : covered ? cov.cursor : null;

  // A refresh from the cursor: what changed since, by Gmail's own history.
  let resynced = false;
  if (cursor) {
    const h = await readHistory(tok, cursor, "INBOX", HISTORY_PAGES);
    if (h.kind === "fail") return failed(h.fail);
    if (h.kind === "ok") {
      const metas = await fetchMetas(tok, [...h.changed]);
      if (metas.failed) return failed(metas.failed);
      const applied = await serviceRpc(env, "email_sync_apply", { p_owner: who.id, p_account: account.id, p_messages: metas.rows, p_removed: [...h.removed, ...metas.gone], p_cursor: h.truncated ? null : (h.historyId ?? cursor), p_advance: true });
      if (applied.error) return failed(fail("UNAVAILABLE"));
      const r = applied.data as { last_sync_at?: string } | null;
      const out = { ok: true, synced: metas.rows.length, removed: h.removed.size + metas.gone.length, next_page: null, complete: false, resynced: false, truncated: h.truncated, last_sync_at: r?.last_sync_at ?? null };
      if (cov === null) return json(out);
      // Current again only when the history was read to its end; cut off at the bound, it is catching up.
      const checked = await serviceRpc(env, "email_coverage_checked", { p_owner: who.id, p_account: account.id, p_epoch: cov.sync_epoch, p_complete: !h.truncated });
      const state = (checked.data as { state?: Coverage } | null)?.state;
      return json({ ...out, coverage_complete: !checked.error && !h.truncated && state?.sync_state === "current", sync_state: state?.sync_state ?? cov.sync_state });
    }
    resynced = true;
  }

  if (cov === null) {
    // Before 0065: the first page of the inbox, and a fresh cursor from the mailbox's own clock.
    const prof = await gmail(tok, "/profile", { safeRead: true });
    if (!prof.ok) return failed(gmailFail(prof));
    const historyId = (prof.body as { historyId?: string }).historyId ?? null;
    const listed = await listPage(tok);
    if ("code" in listed) return failed(listed);
    const metas = await fetchMetas(tok, listed.ids);
    if (metas.failed) return failed(metas.failed);
    const applied = await serviceRpc(env, "email_sync_apply", { p_owner: who.id, p_account: account.id, p_messages: metas.rows, p_removed: metas.gone, p_cursor: historyId, p_advance: true });
    if (applied.error) return failed(fail("UNAVAILABLE"));
    const r = applied.data as { last_sync_at?: string } | null;
    return json({ ok: true, synced: metas.rows.length, removed: metas.gone.length, next_page: listed.next ?? null, complete: !listed.next, resynced, last_sync_at: r?.last_sync_at ?? null });
  }

  return crawl(env, who.id, account.id, tok, cov, resynced, failed);
}

/** The crawl's start: the history checkpoint first (the mailbox's clock now), then catching_up with a fresh epoch. */
async function begin(env: EmailEnv, userId: string, accountId: string, tok: MailboxAuth): Promise<Coverage | Fail> {
  const prof = await gmail(tok, "/profile", { safeRead: true });
  if (!prof.ok) return gmailFail(prof);
  const historyId = (prof.body as { historyId?: string }).historyId;
  if (!historyId) return fail("UNAVAILABLE");
  const r = await serviceRpc(env, "email_coverage_begin", { p_owner: userId, p_account: accountId, p_history_id: historyId, p_labels: [...COVERAGE_LABELS], p_days: COVERAGE_DAYS });
  const d = r.data as (Coverage & { error?: string }) | null;
  if (r.error || !d || d.error || !d.crawl) return fail("UNAVAILABLE");
  return d;
}

async function crawl(env: EmailEnv, userId: string, accountId: string, tok: MailboxAuth, start: Coverage, resyncedIn: boolean, failed: (f: Fail) => Promise<Response>): Promise<Response> {
  const started = Date.now();
  let st = start;
  let resynced = resyncedIn;
  let synced = 0;
  let removed = 0;
  let pages = 0;
  const answer = (o: { coverage_complete: boolean; last_sync_at?: string | null }) =>
    json({ ok: true, synced, removed, next_page: null, complete: false, resynced, coverage_complete: o.coverage_complete, sync_state: o.coverage_complete ? "current" : "catching_up", last_sync_at: o.last_sync_at ?? st.last_sync_at ?? null });

  if (!st.crawl) {
    const b = await begin(env, userId, accountId, tok);
    if ("code" in b) return failed(b);
    st = b;
  }

  // The pages: one label at a time, in the crawl's order, each page durable with its progress before the next is listed.
  while (pages < CRAWL_MAX_PAGES && Date.now() - started < CRAWL_BUDGET_MS) {
    const c = st.crawl!;
    const label = c.order.find((l) => c.labels[l] && !c.labels[l]!.done);
    if (!label) break;
    const lp = c.labels[label]!;
    const afterSec = Math.floor(Date.parse(st.coverage_start ?? "") / 1000);
    if (!Number.isFinite(afterSec)) return failed(fail("UNAVAILABLE"));
    const listed = await coveragePage(tok, label, afterSec, lp.next);
    if ("fail" in listed) {
      if (!listed.badToken) return failed(listed.fail);
      const b = await begin(env, userId, accountId, tok);
      if ("code" in b) return failed(b);
      st = b;
      resynced = true;
      return answer({ coverage_complete: false });
    }
    // An interrupted page (a metadata read that failed) writes nothing: the crawl resumes from the same token next call.
    const metas = await fetchMetas(tok, listed.ids, CRAWL_CONCURRENCY);
    if (metas.failed) return failed(metas.failed);
    const applied = await serviceRpc(env, "email_coverage_page", { p_owner: userId, p_account: accountId, p_epoch: c.epoch, p_label: label, p_page: lp.next, p_next: listed.next, p_messages: metas.rows, p_removed: metas.gone });
    const d = applied.data as { error?: string; upserted?: number; removed?: number; state?: Coverage } | null;
    if (applied.error || !d) return failed(fail("UNAVAILABLE"));
    // Another call moved the crawl on (or restarted it) first: this page was refused whole; the next call carries on from there.
    if (d.error === "STALE_PAGE") return answer({ coverage_complete: false });
    if (d.error || !d.state?.crawl) return failed(fail("UNAVAILABLE"));
    synced += d.upserted ?? 0;
    removed += d.removed ?? 0;
    st = d.state;
    pages++;
  }

  const c = st.crawl!;
  if (c.order.some((l) => c.labels[l] && !c.labels[l]!.done) || Date.now() - started >= CRAWL_BUDGET_MS) return answer({ coverage_complete: false });

  // Every label listed. Reconcile what changed since the checkpoint taken at the crawl's start, for each label, before
  // calling the mailbox current (8.3). The cursor it moves to is the EARLIEST clock the reads answered with, so nothing
  // between the two reads can be skipped.
  const changed = new Set<string>();
  const gone = new Set<string>();
  let cursor: string | undefined;
  for (const label of c.order) {
    const h = await readHistory(tok, c.history_id, label, RECONCILE_PAGES);
    if (h.kind === "fail") return failed(h.fail);
    if (h.kind === "expired") {
      // The crawl outlived Gmail's history: a bounded full resync of the window, from a fresh checkpoint.
      const b = await begin(env, userId, accountId, tok);
      if ("code" in b) return failed(b);
      st = b;
      resynced = true;
      return answer({ coverage_complete: false });
    }
    if (h.truncated) return answer({ coverage_complete: false });
    for (const id of h.changed) changed.add(id);
    for (const id of h.removed) { gone.add(id); changed.delete(id); }
    if (!cursor) cursor = h.historyId;
  }
  const metas = await fetchMetas(tok, [...changed]);
  if (metas.failed) return failed(metas.failed);
  const done = await serviceRpc(env, "email_coverage_complete", { p_owner: userId, p_account: accountId, p_epoch: c.epoch, p_messages: metas.rows, p_removed: [...gone, ...metas.gone], p_cursor: cursor ?? c.history_id });
  const d = done.data as { error?: string; upserted?: number; removed?: number; last_sync_at?: string; state?: Coverage } | null;
  if (done.error || !d) return failed(fail("UNAVAILABLE"));
  if (d.error === "STALE_PAGE" || d.error === "NOT_LISTED") return answer({ coverage_complete: false });
  if (d.error) return failed(fail("UNAVAILABLE"));
  synced += d.upserted ?? 0;
  removed += d.removed ?? 0;
  if (d.state) st = d.state;
  return answer({ coverage_complete: true, last_sync_at: d.last_sync_at ?? null });
}

// The metadata fields a sync asks for, exported for the tests that pin them.
export { META_FIELDS };
