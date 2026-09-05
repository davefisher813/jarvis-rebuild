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

export async function deleteOwnedRows(ctx: ServiceCtx, userId: string, doFetch: FetchLike): Promise<void> {
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
export async function deleteAccountEverywhere(ctx: ServiceCtx, userId: string, doFetch: FetchLike): Promise<{ files: number }> {
  const files = await deleteUserFiles(ctx, userId, doFetch);
  await deleteOwnedRows(ctx, userId, doFetch);
  await deleteAuthUser(ctx, userId, doFetch);
  return { files: files.length };
}
