// SYNC ONE MAILBOX INTO THE CACHE (docs/jarvis-unified, slice 05;
// IMPLEMENTATION-SPEC.md 08 E02, 11). The person pulls to refresh, or opens
// Email, or asks for the next page; nothing here runs on its own. Three
// shapes of one request:
//
//   { email }                 refresh: Gmail's history since the account's
//                             cursor (added, removed, relabelled), or the
//                             first page of the inbox when there is no cursor
//                             or Gmail no longer holds it (a resync, said so).
//   { email, page }           the next page of the inbox, appended; the
//                             cursor and the freshness do not move.
//
// Freshness advances only on a good sync. A failure records its error and
// leaves the last good cache readable. Transport only: no extraction, no
// inference, no cards.
export const config = { runtime: "edge" };

import { authedUser, ensureAccount, failResponse, fail, fetchMetas, gmail, gmailFail, isEmail, json, mailboxToken, readEnv, readBody, recordAccountFailure, serviceRpc, META_FIELDS, type EmailEnv, type Fail } from "../_email";

export const INBOX_PAGE = 30;

interface Body extends Record<string, unknown> { email?: unknown; page?: unknown }

// A failure is recorded by KIND (0055): a revoked grant or a missing scope touches authorization, a storage fault is
// its own state, and a quota or a network blip only makes sync stale. None of the last three can open a reconnect prompt.
async function recordFailure(env: EmailEnv, userId: string, accountId: string, f: Fail): Promise<void> {
  await recordAccountFailure(env, userId, accountId, f);
}

async function listPage(token: string, pageToken?: string): Promise<{ ids: string[]; next?: string } | Fail> {
  const a = await gmail(token, `/messages?labelIds=INBOX&maxResults=${INBOX_PAGE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { safeRead: true });
  if (!a.ok) return gmailFail(a);
  const b = a.body as { messages?: { id: string }[]; nextPageToken?: string };
  return { ids: (b.messages ?? []).map((m) => m.id), ...(b.nextPageToken ? { next: b.nextPageToken } : {}) };
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

  // The next page: appended, nothing else moves.
  if (page) {
    const listed = await listPage(tok.accessToken, page);
    if ("code" in listed) { await recordFailure(env, who.id, account.id, listed); return failResponse(listed); }
    const metas = await fetchMetas(tok.accessToken, listed.ids);
    if (metas.failed) { await recordFailure(env, who.id, account.id, metas.failed); return failResponse(metas.failed); }
    const applied = await serviceRpc(env, "email_sync_apply", { p_owner: who.id, p_account: account.id, p_messages: metas.rows, p_removed: metas.gone, p_cursor: null, p_advance: false });
    if (applied.error) return failResponse(fail("UNAVAILABLE"));
    return json({ ok: true, synced: metas.rows.length, removed: metas.gone.length, next_page: listed.next ?? null, complete: !listed.next, resynced: false });
  }

  // A refresh from the cursor: what changed since, by Gmail's own history.
  let resynced = false;
  if (account.cursor) {
    const changed = new Set<string>();
    const removed = new Set<string>();
    let historyId: string | undefined;
    let pageToken: string | undefined;
    let expired = false;
    let truncated = false;
    for (let i = 0; i < 20; i++) {
      const a = await gmail(tok.accessToken, `/history?startHistoryId=${encodeURIComponent(account.cursor)}&labelId=INBOX&maxResults=500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, { safeRead: true });
      if (a.status === 404) { expired = true; break; }
      if (!a.ok) { const f = gmailFail(a); await recordFailure(env, who.id, account.id, f); return failResponse(f); }
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
      // The loop is bounded. If Gmail still has pages after the last one, what we saw is applied but the cursor must
      // NOT move to it, or the changes in the unread pages would be skipped for good (AC40).
      if (i === 19) truncated = true;
    }
    if (!expired) {
      const metas = await fetchMetas(tok.accessToken, [...changed]);
      if (metas.failed) { await recordFailure(env, who.id, account.id, metas.failed); return failResponse(metas.failed); }
      // "Current" is only true when the cache already covered its declared window and this read reached the end of the
      // history. A truncated read, or an account still catching up, stays catching_up (AC39, AC40).
      const complete = !truncated && account.sync_state === "current";
      const applied = await serviceRpc(env, "email_sync_commit", { p_owner: who.id, p_account: account.id, p_messages: metas.rows, p_removed: [...removed, ...metas.gone], p_cursor: truncated ? null : (historyId ?? account.cursor), p_advance: true, p_complete: complete });
      if (applied.error) return failResponse(fail("UNAVAILABLE"));
      const r = applied.data as { last_sync_at?: string } | null;
      return json({ ok: true, synced: metas.rows.length, removed: removed.size + metas.gone.length, next_page: null, complete: false, resynced: false, truncated, last_sync_at: r?.last_sync_at ?? null });
    }
    resynced = true;
  }

  // No cursor, or Gmail no longer holds ours: the first page of the inbox,
  // and a fresh cursor from the mailbox's own clock.
  const prof = await gmail(tok.accessToken, "/profile", { safeRead: true });
  if (!prof.ok) { const f = gmailFail(prof); await recordFailure(env, who.id, account.id, f); return failResponse(f); }
  const historyId = (prof.body as { historyId?: string }).historyId ?? null;
  const listed = await listPage(tok.accessToken);
  if ("code" in listed) { await recordFailure(env, who.id, account.id, listed); return failResponse(listed); }
  const metas = await fetchMetas(tok.accessToken, listed.ids);
  if (metas.failed) { await recordFailure(env, who.id, account.id, metas.failed); return failResponse(metas.failed); }
  // The first page of the inbox is not the declared window: catching_up, never current, until the worker has walked it.
  const applied = await serviceRpc(env, "email_sync_commit", { p_owner: who.id, p_account: account.id, p_messages: metas.rows, p_removed: metas.gone, p_cursor: historyId, p_advance: true, p_complete: false });
  if (applied.error) return failResponse(fail("UNAVAILABLE"));
  const r = applied.data as { last_sync_at?: string } | null;
  return json({ ok: true, synced: metas.rows.length, removed: metas.gone.length, next_page: listed.next ?? null, complete: !listed.next, resynced, last_sync_at: r?.last_sync_at ?? null });
}

// The metadata fields a sync asks for, exported for the tests that pin them.
export { META_FIELDS };
