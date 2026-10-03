// THE EMAIL ROUTES' SHARED HALF (docs/jarvis-unified, slice 05;
// IMPLEMENTATION-SPEC.md section 11). The Gmail token lives here and nowhere
// the browser or an agent can see: a route takes the person's JARVIS session,
// finds the stored sign-in for the account they named (api/google.ts wrote
// it), mints an access token, calls Gmail, and writes what came back into the
// provider cache through the service-role functions of migration 0048. The
// browser reads the cache through its own session. Nothing here extracts,
// ranks or infers; nothing here runs on a schedule.

import { decrypt, refreshAccessToken, type GoogleClients } from "./_google";
import { extractBody, extractHtml, type GmailFull, type GmailHeader, type GmailMeta, type GmailPart } from "../src/connections/google/map";

export interface EmailEnv {
  supaUrl: string;
  anon: string;
  service: string;
  tokenKey: string;
  clients: GoogleClients;
}

/** Every variable is already documented in .env.example (the Supabase and Google blocks). */
export function readEnv(): EmailEnv | null {
  const supaUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const tokenKey = process.env.GOOGLE_TOKEN_KEY || "";
  const clients: GoogleClients = {
    clientId: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    iosClientId: process.env.GOOGLE_IOS_CLIENT_ID || process.env.VITE_GOOGLE_IOS_CLIENT_ID || "",
  };
  if (!supaUrl || !anon || !service || !tokenKey || !clients.clientId) return null;
  return { supaUrl, anon, service, tokenKey, clients };
}

export const EMAIL_CODES = ["AUTH_REQUIRED", "PROVIDER_AUTH", "RATE_LIMITED", "UNAVAILABLE", "NOT_FOUND", "INVALID_PAYLOAD", "STORAGE_LIMIT"] as const;
export type EmailCode = (typeof EMAIL_CODES)[number];

export interface Fail { code: EmailCode; safe_message: string; retryable: boolean; status: number; retry_after?: number }

/** The one safe line per code (API-AND-VALIDATION.md, the error vocabulary); never a token, never mail. */
export function fail(code: EmailCode, retryAfter?: number): Fail {
  switch (code) {
    case "AUTH_REQUIRED": return { code, status: 401, retryable: false, safe_message: "Sign in to continue." };
    case "PROVIDER_AUTH": return { code, status: 410, retryable: false, safe_message: "Reconnect Gmail to continue." };
    case "RATE_LIMITED": return { code, status: 429, retryable: true, safe_message: "Gmail needs a moment. Try again shortly.", ...(retryAfter ? { retry_after: retryAfter } : {}) };
    case "NOT_FOUND": return { code, status: 404, retryable: false, safe_message: "That message isn't here." };
    case "INVALID_PAYLOAD": return { code, status: 422, retryable: false, safe_message: "That request isn't one this door takes." };
    case "STORAGE_LIMIT": return { code, status: 413, retryable: false, safe_message: "This attachment exceeds the 20 MB message limit." };
    case "UNAVAILABLE": return { code, status: 503, retryable: true, safe_message: "Couldn't reach Gmail. Try again." };
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function failResponse(f: Fail): Response {
  return json({ code: f.code, safe_message: f.safe_message, retryable: f.retryable, ...(f.retry_after ? { retry_after: f.retry_after } : {}) }, f.status, f.retry_after ? { "retry-after": String(f.retry_after) } : {});
}

/** Whose request this is: the JARVIS session, checked with the auth service. */
export async function authedUser(req: Request, env: EmailEnv): Promise<{ id: string } | Fail> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return fail("AUTH_REQUIRED");
  let who: Response;
  try {
    who = await fetch(`${env.supaUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.anon } });
  } catch {
    return fail("UNAVAILABLE");
  }
  if (who.status === 429 || who.status >= 500) return fail("UNAVAILABLE");
  if (!who.ok) return fail("AUTH_REQUIRED");
  const u = (await who.json().catch(() => ({}))) as { id?: string };
  return u.id ? { id: u.id } : fail("AUTH_REQUIRED");
}

/** The session's token as the request carried it, for a call made as the person. */
export function bearerOf(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

export interface RpcResult { data: unknown; error: unknown }

/** A call to one of the person's own functions, as the person: auth.uid() is theirs, the row policies are theirs, nothing is widened. */
export async function userRpc(env: EmailEnv, token: string, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  try {
    const r = await fetch(`${env.supaUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: env.anon, Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const data = await r.json().catch(() => null);
    return r.ok ? { data, error: null } : { data: null, error: { status: r.status, data } };
  } catch (err) {
    return { data: null, error: err };
  }
}

/** A service-role call to one of the cache's functions. */
export async function serviceRpc(env: EmailEnv, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  try {
    const r = await fetch(`${env.supaUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: env.service, Authorization: `Bearer ${env.service}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const data = await r.json().catch(() => null);
    return r.ok ? { data, error: null } : { data: null, error: { status: r.status } };
  } catch (e) {
    return { data: null, error: e };
  }
}

/** A service-role read of one table, scoped to the owner the session proved. */
export async function serviceSelect<T>(env: EmailEnv, table: string, query: string): Promise<T[] | null> {
  try {
    const r = await fetch(`${env.supaUrl}/rest/v1/${table}?${query}`, { headers: { apikey: env.service, Authorization: `Bearer ${env.service}` } });
    if (!r.ok) return null;
    return (await r.json()) as T[];
  } catch {
    return null;
  }
}

/** The account row for this person and address, made if missing (the mirror of a stored sign-in). */
export async function ensureAccount(env: EmailEnv, userId: string, email: string): Promise<{ id: string; cursor: string | null; state: string } | Fail> {
  const up = await serviceRpc(env, "email_account_upsert", { p_owner: userId, p_address: email, p_scopes: [], p_capabilities: { archive: true, trash: true, read: true } });
  const id = (up.data as { account_id?: string } | null)?.account_id;
  if (!id) return fail("UNAVAILABLE");
  const rows = await serviceSelect<{ id: string; cursor: string | null; state: string }>(env, "email_account", `id=eq.${id}&owner_id=eq.${userId}&select=id,cursor,state`);
  const row = rows?.[0];
  return row ?? { id, cursor: null, state: "connected" };
}

/** A fresh access token for this person's stored sign-in to this address. Never leaves the server. */
export async function mailboxToken(env: EmailEnv, userId: string, email: string): Promise<{ ok: true; accessToken: string } | { ok: false; fail: Fail; reauth: boolean }> {
  const rows = await serviceSelect<{ token_enc: string }>(env, "google_tokens", `user_id=eq.${userId}&email=eq.${encodeURIComponent(email)}&select=token_enc`);
  if (rows === null) return { ok: false, fail: fail("UNAVAILABLE"), reauth: false };
  const row = rows[0];
  if (!row) return { ok: false, fail: fail("PROVIDER_AUTH"), reauth: true };
  let stored: string;
  try {
    stored = await decrypt(row.token_enc, env.tokenKey);
  } catch {
    return { ok: false, fail: fail("PROVIDER_AUTH"), reauth: true };
  }
  let got: Awaited<ReturnType<typeof refreshAccessToken>>;
  try {
    got = await refreshAccessToken(stored, env.clients);
  } catch {
    return { ok: false, fail: fail("UNAVAILABLE"), reauth: false };
  }
  if (!got.ok) {
    const revoked = /invalid_grant|invalid_client|unauthorized_client/i.test(got.error);
    return { ok: false, fail: fail(revoked ? "PROVIDER_AUTH" : "UNAVAILABLE"), reauth: revoked };
  }
  return { ok: true, accessToken: got.got.accessToken };
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailAnswer { ok: boolean; status: number; body: unknown; retryAfter?: number }

/** One Gmail call. Safe reads retry on a 5xx or a dropped connection, three times at most, honouring Retry-After; writes never retry. */
export async function gmail(accessToken: string, path: string, init: { method?: string; body?: unknown; safeRead?: boolean } = {}): Promise<GmailAnswer> {
  const tries = init.safeRead ? 3 : 1;
  let last: GmailAnswer = { ok: false, status: 0, body: null };
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${GMAIL}${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${accessToken}`, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      const retryAfter = Number(r.headers.get("retry-after") || "") || undefined;
      const body = await r.json().catch(() => null);
      last = { ok: r.ok, status: r.status, body, ...(retryAfter ? { retryAfter } : {}) };
      if (r.ok || r.status < 500) return last;
    } catch {
      last = { ok: false, status: 0, body: null };
    }
    if (i + 1 < tries) await new Promise((res) => setTimeout(res, 250 * (i + 1)));
  }
  return last;
}

/** Gmail's refusals as the vocabulary's codes. */
export function gmailFail(a: GmailAnswer): Fail {
  if (a.status === 401 || a.status === 403) return fail("PROVIDER_AUTH");
  if (a.status === 429) return fail("RATE_LIMITED", a.retryAfter ?? 5);
  if (a.status === 404) return fail("NOT_FOUND");
  return fail("UNAVAILABLE");
}

// ---- The headers, read without a DOM. ------------------------------------

export function headerOf(headers: GmailHeader[] | undefined, name: string): string {
  const n = name.toLowerCase();
  return headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
}

export interface Address { address: string; name: string }

/** "Con Edison <billing@conedison.test>, b@x.test" -> the parts, lowercased addresses, bidi marks removed from names. */
export function addressList(raw: string): Address[] {
  const out: Address[] = [];
  const clean = raw.replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, "");
  for (const part of clean.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/.exec(p);
    if (m) out.push({ name: (m[1] ?? "").trim(), address: m[2]!.trim().toLowerCase() });
    else if (/@/.test(p)) out.push({ name: "", address: p.replace(/^<|>$/g, "").toLowerCase() });
  }
  return out;
}

export const firstAddress = (raw: string): Address => addressList(raw)[0] ?? { address: "", name: "" };

export interface AttachmentMeta { filename: string; mime: string; attachmentId: string; size: number }

/** Attachment metadata only: name, type, provider id, size. Never bytes. The filename is kept to printable characters. */
export function attachmentsOf(part: GmailPart | undefined, out: AttachmentMeta[] = []): AttachmentMeta[] {
  if (!part) return out;
  const p = part as GmailPart & { filename?: string; body?: { attachmentId?: string; size?: number } };
  if (p.filename && p.body?.attachmentId) {
    out.push({ filename: p.filename.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 200) || "attachment", mime: p.mimeType ?? "application/octet-stream", attachmentId: p.body.attachmentId, size: p.body.size ?? 0 });
  }
  for (const c of p.parts ?? []) attachmentsOf(c, out);
  return out;
}

/** What the cache keeps of a message's metadata (email_sync_apply's row). */
export interface CachedRow {
  provider_id: string;
  thread_id: string;
  internal_date: string;
  from_address: string;
  from_name: string;
  to_addresses: Address[];
  cc_addresses: Address[];
  subject: string;
  snippet: string;
  labels: string[];
  attachments: AttachmentMeta[];
  history_id?: string;
}

export function toCachedRow(meta: GmailMeta & { historyId?: string; threadId?: string }): CachedRow {
  const hs = meta.payload?.headers;
  const from = firstAddress(headerOf(hs, "From"));
  const ms = Number(meta.internalDate);
  return {
    provider_id: meta.id,
    thread_id: meta.threadId || meta.id,
    internal_date: new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now()).toISOString(),
    from_address: from.address,
    from_name: from.name,
    to_addresses: addressList(headerOf(hs, "To")),
    cc_addresses: addressList(headerOf(hs, "Cc")),
    subject: headerOf(hs, "Subject"),
    snippet: decodeEntities(meta.snippet ?? ""),
    labels: meta.labelIds ?? [],
    attachments: attachmentsOf(meta.payload as GmailPart | undefined),
    ...(meta.historyId ? { history_id: meta.historyId } : {}),
  };
}

/** Gmail's snippets carry HTML entities; the cache keeps words. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, code: string) => {
    const c = code.toLowerCase();
    if (c === "amp") return "&"; if (c === "lt") return "<"; if (c === "gt") return ">"; if (c === "quot") return '"'; if (c === "apos") return "'"; if (c === "nbsp") return " ";
    const n = c.startsWith("#x") ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
}

export const META_FIELDS = "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date";

/** Metadata for many ids, a few at a time; a 404 is a message that left. */
export async function fetchMetas(accessToken: string, ids: readonly string[], concurrency = 6): Promise<{ rows: CachedRow[]; gone: string[]; failed: Fail | null }> {
  const rows: CachedRow[] = [];
  const gone: string[] = [];
  let failed: Fail | null = null;
  let i = 0;
  const worker = async () => {
    while (i < ids.length && !failed) {
      const id = ids[i++]!;
      const a = await gmail(accessToken, `/messages/${encodeURIComponent(id)}?${META_FIELDS}`, { safeRead: true });
      if (a.ok) rows.push(toCachedRow(a.body as GmailMeta));
      else if (a.status === 404) gone.push(id);
      else failed = gmailFail(a);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { rows, gone, failed };
}

/** A cached row as the list reads it back (email_message's columns the screens use). */
export interface CachedListRow {
  id: string;
  account_id: string;
  provider_id: string;
  thread_id: string;
  internal_date: string;
  from_address: string;
  from_name: string;
  subject: string;
  snippet: string;
  has_body: boolean;
  attachment_metadata: AttachmentMeta[];
  provider_labels: string[];
  source_hash: string;
}

export const LIST_COLUMNS = "id,account_id,provider_id,thread_id,internal_date,from_address,from_name,subject,snippet,has_body,attachment_metadata,provider_labels,source_hash";

/** Newest first by the provider's receipt time, then by id: the one order every list keeps. */
export function newestFirst<T extends { internal_date: string; provider_id: string }>(x: T, y: T): number {
  return String(y.internal_date).localeCompare(String(x.internal_date)) || String(y.provider_id).localeCompare(String(x.provider_id));
}

/** The body of a full message: plain text, the HTML as sent, the attachments' metadata. */
export function bodyOf(full: GmailFull): { text: string; html: string | null; attachments: AttachmentMeta[] } {
  return { text: extractBody(full.payload), html: extractHtml(full.payload), attachments: attachmentsOf(full.payload as GmailPart | undefined) };
}

/** The request body, as an object or nothing. */
export async function readBody<T extends Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const b = (await req.json()) as unknown;
    return b && typeof b === "object" && !Array.isArray(b) ? (b as T) : null;
  } catch {
    return null;
  }
}

export const isEmail = (s: unknown): s is string => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 320;
export const isId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(s);
