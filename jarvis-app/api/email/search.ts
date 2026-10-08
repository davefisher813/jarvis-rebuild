// SEARCH GMAIL, LITERALLY (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md
// 08 E03, 11). The person's words go to Gmail as a quoted phrase, in one
// account or every connected one; the hits are cached (so they open like any
// row) without moving any cursor or freshness; the answer says exactly which
// accounts were covered and which failed. No natural language, no inference.
export const config = { runtime: "edge" };

import { authedUser, ensureAccount, failResponse, fail, fetchMetas, gmail, gmailFail, isEmail, json, LIST_COLUMNS, mailboxToken, newestFirst, readEnv, readBody, serviceRpc, serviceSelect, type CachedListRow, type EmailEnv } from "../_email";

export const SEARCH_PAGE = 30;
export const QUERY_MAX = 200;

/** The literal phrase Gmail is asked for: the words as typed, quoted, with the quote character itself dropped. */
export function literalQuery(text: string): string {
  const t = text.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
  return t ? `"${t}"` : "";
}

interface Body extends Record<string, unknown> { q?: unknown; email?: unknown; page?: unknown }

export type SearchRow = CachedListRow & { account: string; read: boolean };

async function searchOne(env: EmailEnv, userId: string, email: string, q: string, page: string | null): Promise<{ email: string; rows: SearchRow[]; next_page: string | null } | { email: string; failed: string }> {
  const account = await ensureAccount(env, userId, email);
  if ("code" in account) return { email, failed: account.code };
  const tok = await mailboxToken(env, userId, email);
  if (!tok.ok) return { email, failed: tok.fail.code };
  const a = await gmail(tok, `/messages?q=${encodeURIComponent(q)}&maxResults=${SEARCH_PAGE}${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, { safeRead: true });
  if (!a.ok) return { email, failed: gmailFail(a).code };
  const b = a.body as { messages?: { id: string }[]; nextPageToken?: string };
  const metas = await fetchMetas(tok, (b.messages ?? []).map((m) => m.id));
  if (metas.failed) return { email, failed: metas.failed.code };
  const applied = await serviceRpc(env, "email_sync_apply", { p_owner: userId, p_account: account.id, p_messages: metas.rows, p_removed: metas.gone, p_cursor: null, p_advance: false });
  if (applied.error) return { email, failed: "UNAVAILABLE" };
  const ids = metas.rows.map((r) => r.provider_id);
  const cached = ids.length ? await serviceSelect<CachedListRow>(env, "email_message", `owner_id=eq.${userId}&account_id=eq.${account.id}&provider_id=in.(${ids.map(encodeURIComponent).join(",")})&select=${LIST_COLUMNS}`) : [];
  const rows: SearchRow[] = (cached ?? []).map((r) => ({ ...r, account: email, read: !(r.provider_labels ?? []).includes("UNREAD") })).sort(newestFirst);
  return { email, rows, next_page: b.nextPageToken ?? null };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const env = readEnv();
  if (!env) return failResponse(fail("UNAVAILABLE"));
  const who = await authedUser(req, env);
  if ("code" in who) return failResponse(who);
  const body = await readBody<Body>(req);
  if (!body || typeof body.q !== "string" || body.q.trim().length === 0 || body.q.length > QUERY_MAX) return failResponse(fail("INVALID_PAYLOAD"));
  const q = literalQuery(body.q);
  if (!q) return failResponse(fail("INVALID_PAYLOAD"));
  const page = typeof body.page === "string" && body.page.length <= 512 ? body.page : null;

  let emails: string[];
  if (isEmail(body.email)) emails = [body.email.toLowerCase()];
  else {
    const rows = await serviceSelect<{ email: string }>(env, "google_tokens", `user_id=eq.${who.id}&select=email`);
    if (rows === null) return failResponse(fail("UNAVAILABLE"));
    emails = rows.map((r) => r.email.toLowerCase());
    if (page) emails = emails.slice(0, 1);
  }
  if (emails.length === 0) return json({ ok: true, q, rows: [], covered: [], failed: [], next_page: null, coverage: "provider" });

  const results = await Promise.all(emails.map((e) => searchOne(env, who.id, e, q, page)));
  const rows = results.flatMap((r) => ("rows" in r ? r.rows : [])).sort(newestFirst);
  const covered = results.filter((r) => "rows" in r).map((r) => r.email);
  const failed = results.filter((r) => "failed" in r).map((r) => ({ email: r.email, code: (r as { failed: string }).failed }));
  const next = results.find((r) => "next_page" in r && r.next_page) as { email: string; next_page: string } | undefined;
  return json({ ok: true, q, rows, covered, failed, next_page: next ? { email: next.email, page: next.next_page } : null, coverage: "provider" });
}
