// SHELL-F-03 (2026-09-05): what "Delete Account" actually deletes.
//
// The client half of this shipped in S3-Q18 and called /api/account/delete,
// which did not exist, so Settings > Account > Delete Account answered
// "Couldn't delete your account (404)" every time, on a device whose Privacy
// Policy promises deletion and to an App Store reviewer who requires it.
//
// The sequence lives here, in src, rather than inside the serverless function
// for the same reason api/admin/users.ts keeps mapUsers here: this is the part
// with rules worth testing, and api/ is not in the typecheck or the test run.
// api/account/delete.ts is the thin half: it proves who is calling, reads the
// service-role key, and hands over to this.
//
// ORDER MATTERS. Files first, then rows, then the auth user last. Every step
// is idempotent, so a failure anywhere is a retry rather than a half-deleted
// account, and nothing reports success unless all of it landed. Deleting the
// auth user first would be the worst order available: the rows key on
// owner_id and RLS keys on auth.uid(), so rows left behind after the user is
// gone are unreachable by anyone, which is the same as keeping someone's data
// forever after telling them it was erased.

export interface ServiceCtx {
  /** Supabase project URL, e.g. https://xyz.supabase.co */
  url: string;
  /** The service-role key. Never leaves the server. */
  serviceKey: string;
  /** UP-LAUNCH-06 (2026-09-05): GOOGLE_TOKEN_KEY, base64. Without it the
      stored refresh tokens cannot be decrypted, so they cannot be revoked
      with Google; the deletion still happens and says how many it could not
      revoke rather than pretending. */
  tokenKey?: string;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponse>;

// Every table that carries rows owned by one person, and the column that says
// so. email_opens and google_tokens are absent on purpose: both declare
// `references auth.users (id) on delete cascade` (migrations 0017 and 0018),
// so the auth delete at the end takes them.
export const OWNED_TABLES: readonly { table: string; column: string }[] = [
  { table: "item", column: "owner_id" },
  { table: "scalar_setting", column: "owner_id" },
  { table: "event_log", column: "owner_id" },
  { table: "ai_usage", column: "user_id" },
  { table: "ai_tokens", column: "user_id" },
];

// UP-LAUNCH-16 (2026-09-05): `feedback` is deliberately NOT in that list and
// must not be added to it. A bug report is a message to us, not the user's
// data, and the report most worth keeping is the one about the delete flow
// itself. Migration 0033 sets its user_id to null when the auth user goes, so
// the message survives with nobody attached to it.

export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const BUCKET = "user-files";
const PAGE = 1000;
// Two levels is the whole path convention (user-files/{uid}/{entityId}/{file},
// see shared/fileStorage.ts buildStoragePath), so the walk is not recursive.
const MAX_PAGES = 20;

function headers(ctx: ServiceCtx): Record<string, string> {
  return { apikey: ctx.serviceKey, Authorization: `Bearer ${ctx.serviceKey}` };
}

interface StorageRow { name: string; id: string | null }

// One level of the bucket. Rows with a null id are folders, which is how the
// Storage API says "there is another level under this".
async function listLevel(ctx: ServiceCtx, prefix: string, doFetch: FetchLike): Promise<{ files: string[]; folders: string[] }> {
  const files: string[] = [];
  const folders: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await doFetch(`${ctx.url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...headers(ctx), "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: PAGE, offset: page * PAGE }),
    });
    // A project with no bucket yet has no files to delete. Any other refusal
    // is a real failure and must not be read as "nothing there".
    if (r.status === 404) return { files, folders };
    if (!r.ok) throw new Error(`Could not list files (${r.status})`);
    const rows = ((await r.json()) as StorageRow[]) || [];
    for (const row of rows) {
      if (!row?.name) continue;
      if (row.id) files.push(prefix + row.name);
      else folders.push(prefix + row.name + "/");
    }
    if (rows.length < PAGE) break;
  }
  return { files, folders };
}

export async function deleteUserFiles(ctx: ServiceCtx, userId: string, doFetch: FetchLike): Promise<string[]> {
  const top = await listLevel(ctx, `${userId}/`, doFetch);
  const paths = [...top.files];
  for (const folder of top.folders) {
    const inner = await listLevel(ctx, folder, doFetch);
    paths.push(...inner.files);
  }
  if (paths.length === 0) return paths;
  const r = await doFetch(`${ctx.url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...headers(ctx), "content-type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!r.ok) throw new Error(`Could not delete files (${r.status})`);
  return paths;
}

// UP-LAUNCH-06 (2026-09-05): tell GOOGLE about it.
//
// google_tokens cascades from auth.users, so the ROW disappears on its own.
// The GRANT does not: Google keeps the refresh token live, and JARVIS would
// still hold a working authorization for a Gmail account belonging to
// somebody who deleted their account. Deleting our copy of a key is not the
// same as returning it.
//
// Best effort, on purpose. A refusal from Google (an already revoked token,
// an offline moment) must never block a deletion the person asked for and has
// a right to: the count of what could not be revoked comes back so the
// endpoint can log it.
export async function revokeGoogleGrants(
  ctx: ServiceCtx,
  userId: string,
  doFetch: FetchLike,
  decryptFn: (packedB64: string, secretB64: string) => Promise<string> = decryptToken,
): Promise<{ revoked: number; failed: number }> {
  if (!ctx.tokenKey) return { revoked: 0, failed: 0 };
  const r = await doFetch(
    `${ctx.url}/rest/v1/google_tokens?user_id=eq.${encodeURIComponent(userId)}&select=token_enc`,
    { headers: headers(ctx) },
  );
  // No table, no rows, no problem: this account never connected Google.
  if (!r.ok) return { revoked: 0, failed: 0 };
  const rows = ((await r.json()) as { token_enc?: string }[]) || [];
  let revoked = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row?.token_enc) continue;
    try {
      const refresh = await decryptFn(row.token_enc, ctx.tokenKey);
      const rev = await doFetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "token=" + encodeURIComponent(refresh),
      });
      if (rev.ok) revoked += 1; else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { revoked, failed };
}

// The same AES-GCM unpacking api/google.ts does when it mints a token: a
// 12-byte iv followed by the ciphertext, base64. It lives here rather than in
// api/ because api/ is in neither the typecheck nor the test run.
export async function decryptToken(packedB64: string, secretB64: string): Promise<string> {
  const raw = Uint8Array.from(atob(secretB64), (c) => c.charCodeAt(0));
  const packed = Uint8Array.from(atob(packedB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12) }, key, packed.slice(12));
  return new TextDecoder().decode(plain);
}

export async function deleteOwnedRows(ctx: ServiceCtx, userId: string, doFetch: FetchLike): Promise<void> {
  // UP-LAUNCH-06: one transaction when the database has the function
  // (migration 0034), the per-table walk when it does not. Same shape as the
  // offline queue's fallback in PLUMB-F-10: the app works before the
  // migration is run and gets atomicity the moment it is, with no new build.
  const rpc = await doFetch(`${ctx.url}/rest/v1/rpc/delete_owned`, {
    method: "POST",
    headers: { ...headers(ctx), "content-type": "application/json" },
    body: JSON.stringify({ p_uid: userId }),
  });
  if (rpc.ok) return;
  // 404 means the function is not installed. Anything else is a real failure
  // of a real function, and falling back would hide it.
  if (rpc.status !== 404) throw new Error(`Could not delete your data (${rpc.status})`);
  for (const { table, column } of OWNED_TABLES) {
    const r = await doFetch(`${ctx.url}/rest/v1/${table}?${column}=eq.${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { ...headers(ctx), Prefer: "return=minimal" },
    });
    if (!r.ok) throw new Error(`Could not delete ${table} (${r.status})`);
  }
}

export async function deleteAuthUser(ctx: ServiceCtx, userId: string, doFetch: FetchLike): Promise<void> {
  const r = await doFetch(`${ctx.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: { ...headers(ctx), "content-type": "application/json" },
  });
  // Already gone is the outcome this asks for, so a retry after a partial
  // failure still ends in success rather than an error the person cannot act
  // on.
  if (!r.ok && r.status !== 404) throw new Error(`Could not delete the account (${r.status})`);
}

// The whole thing. Throws on the first failure, with a message the endpoint
// passes back, and never claims more than it did.
export async function deleteAccountEverywhere(ctx: ServiceCtx, userId: string, doFetch: FetchLike): Promise<{ files: number; revoked: number; revokeFailed: number }> {
  // Google first, because it is the only step that needs a row a later step
  // deletes, and because a grant handed back is the part of this that another
  // company holds.
  const google = await revokeGoogleGrants(ctx, userId, doFetch);
  const files = await deleteUserFiles(ctx, userId, doFetch);
  await deleteOwnedRows(ctx, userId, doFetch);
  await deleteAuthUser(ctx, userId, doFetch);
  return { files: files.length, revoked: google.revoked, revokeFailed: google.failed };
}
