import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DataAdapter } from "./adapter.js";
import type { Item, ItemData, ServerTime } from "./types.js";

// The real database backend. Verified on device, not in this repo's automated
// tests, because the sandbox has no network. It compiles and typechecks here;
// its live behavior (row-level security, hard delete, monotonic updated_at) is
// proven by docs/verify-rls.mjs run against a real Supabase project.
//
// Owner isolation is enforced by row-level security keyed to the signed-in
// user (auth.uid()). The ownerId argument is kept for interface parity with
// the in-memory adapter; the database is the source of truth for who owns what,
// so reads, updates, and deletes are RLS-scoped to the session regardless.
//
// Server time: production uses the row's monotonic updated_at, stamped by a
// trigger. The optional serverTime argument (used by tests to reproduce exact
// orderings) is ignored here; the server owns time. Last-write-wins is provided
// by the monotonic stamp plus server-side serialization of writes. This is the
// agreed scalar-sync model; deeper per-field / CRDT merge is out of scope.

interface ItemRow {
  id: string;
  owner_id: string;
  entity_type: string;
  data: ItemData;
  updated_at: string;
  // Phase 0 D8 (2026-10-10): read at last. The column has been on the row
  // since migration 0001; both select lists below now ask for it.
  created_at: string;
}

// PostgREST's answer when the RPC does not exist in the database yet.
function isMissingFunction(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const o = e as { code?: unknown; message?: unknown };
  if (o.code === "PGRST202" || o.code === "42883") return true;
  return typeof o.message === "string" && /could not find the function|does not exist/i.test(o.message);
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    ownerId: row.owner_id,
    entityType: row.entity_type,
    data: row.data,
    // updated_at is the authoritative server time; exposed as epoch millis so
    // callers have a comparable monotonic value matching the in-memory model.
    serverTime: Date.parse(row.updated_at),
    // Phase 0 D8: when the record was made, epoch ms, same unit as serverTime
    // so the in-memory adapter and this one answer one shape.
    createdAt: Date.parse(row.created_at),
  };
}

// Phase 0 D1 change 2 (2026-10-10): both select lists read the same columns.
// One constant so the two cannot drift apart; jarvis-app's
// supabaseAdapter.test.ts pins the string.
const ITEM_COLUMNS = "id, owner_id, entity_type, data, updated_at, created_at";

export class SupabaseAdapter implements DataAdapter {
  constructor(private readonly db: SupabaseClient) {}

  async create(
    _ownerId: string,
    entityType: string,
    data: ItemData,
    id?: string,
    createdAt?: number
  ): Promise<string> {
    // owner_id defaults to auth.uid() in the schema; RLS with-check validates it.
    // id is the row's uuid primary key with its own gen_random_uuid() default;
    // supplying one (a create replaying from the offline queue, S3-Q14) simply
    // overrides that default, same as any explicit insert value would.
    //
    // Phase 0 D1 change 2 (2026-10-10): created_at the same way. Its default
    // is now(), which for a create held offline is the reconnect, not the
    // capture; the drain passes the queued moment and the row is dated by it.
    // The owner may set the column (item_insert's with check is owner_id
    // only, migration 0001), and the history trigger in 0060 reads
    // new.created_at as the insert's client_at.
    const { data: row, error } = await this.db
      .from("item")
      .insert({
        ...(id ? { id } : {}),
        ...(createdAt !== undefined ? { created_at: new Date(createdAt).toISOString() } : {}),
        entity_type: entityType,
        data,
      })
      .select("id")
      .single();
    if (error) {
      // H-51 (Health Push F, 2026-09-13): migration 0039 makes a second
      // arrival of the same clientId a duplicate key. The row that landed
      // first is the answer, so a replayed queue entry resolves to it rather
      // than wedging the queue or writing a twin. RLS scopes the read to the
      // owner, the same way the insert was scoped.
      const clientId = typeof data.clientId === "string" ? data.clientId : null;
      if (clientId && (error as { code?: unknown }).code === "23505") {
        const { data: hit, error: readError } = await this.db
          .from("item")
          .select("id")
          .eq("entity_type", entityType)
          .eq("data->>clientId", clientId)
          .limit(1)
          .maybeSingle();
        if (!readError && hit) return (hit as { id: string }).id;
      }
      throw error;
    }
    return (row as { id: string }).id;
  }

  async createMany(_ownerId: string, entityType: string, datas: ItemData[]): Promise<string[]> {
    if (datas.length === 0) return [];
    // One INSERT for the whole batch; RLS with-check validates every row.
    const { data: rows, error } = await this.db
      .from("item")
      .insert(datas.map((data) => ({ entity_type: entityType, data })))
      .select("id");
    if (error) throw error;
    return (rows as { id: string }[]).map((r) => r.id);
  }

  async read(_ownerId: string, id: string): Promise<Item | null> {
    // RLS returns no row if the caller does not own it, so this is null-safe
    // for both missing and not-owned ids.
    const { data: row, error } = await this.db
      .from("item")
      .select(ITEM_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return row ? toItem(row as ItemRow) : null;
  }

  async apply(
    _ownerId: string,
    id: string,
    patch: ItemData,
    serverTime?: ServerTime,
    clientAt?: number
  ): Promise<boolean> {
    // The live server owns time, so an explicit serverTime (used only by tests
    // to reproduce exact orderings) is ignored here; the trigger stamps
    // updated_at monotonically on apply.
    void serverTime;
    // Server-side atomic JSONB merge inside RLS. Returns true if a row the
    // caller owns was updated; false for missing or not-owned ids (D6, D9).
    //
    // Phase 0 D1 change 2 (2026-10-10): migration 0060 recreates the function
    // as item_apply_patch(p_id, p_patch, p_client_at default null), and the
    // history trigger dates the change by p_client_at when it is given. The
    // third argument is sent only when the Store has one (a held edit
    // replaying), so a live edit keeps the two argument call shape and the
    // database that has not run 0060 yet keeps resolving it.
    const { data: applied, error } = await this.db.rpc("item_apply_patch", {
      p_id: id,
      p_patch: patch,
      ...(clientAt !== undefined ? { p_client_at: new Date(clientAt).toISOString() } : {}),
    });
    if (error) throw error;
    return applied === true;
  }

  // PLUMB-F-10 (2026-09-05): the replay of an offline edit, carrying the
  // moment it was MADE. item_apply_patch_if_older (migration 0032) compares
  // that against the row's updated_at inside RLS and refuses a patch older
  // than what is already there, so the 9 AM name from a phone that
  // reconnects at 5 PM can no longer replace the noon name from the laptop.
  // Same merge as item_apply_patch when it does apply, strip-nulls and all.
  async applyIfOlder(
    _ownerId: string,
    id: string,
    patch: ItemData,
    clientAt: number
  ): Promise<"applied" | "stale" | "missing"> {
    const { data: outcome, error } = await this.db.rpc("item_apply_patch_if_older", {
      p_id: id,
      p_patch: patch,
      p_client_at: new Date(clientAt).toISOString(),
    });
    if (error) {
      // BEFORE THE MIGRATION IS RUN. Dave pastes migrations into the SQL
      // editor by hand, so there is a window where the app has shipped and
      // 0032 has not. PostgREST answers a call to a function it cannot find
      // with PGRST202; falling back to the unconditional merge keeps the
      // queue draining exactly as it did before this fix, and the age check
      // starts working the moment the function exists, with no app change.
      if (isMissingFunction(error)) {
        return (await this.apply(_ownerId, id, patch)) ? "applied" : "missing";
      }
      throw error;
    }
    return outcome === "applied" || outcome === "stale" ? outcome : "missing";
  }

  async del(_ownerId: string, id: string, clientAt?: number): Promise<void> {
    // RLS makes deleting a missing or not-owned id a safe no-op (D4, D5, D6, D9).
    //
    // Phase 0 D1 change 2 (2026-10-10): clientAt is accepted and not sent. The
    // history trigger reads a delete's client_at from the jarvis.client_at
    // session setting, and only the SQL patch functions write it; PostgREST
    // cannot run set_config ahead of this DELETE in one transaction. A delete
    // RPC that takes p_client_at is the fix, and when it exists this is the
    // one line that changes. Until then a replayed delete is dated by now().
    void clientAt;
    const { error } = await this.db.from("item").delete().eq("id", id);
    if (error) throw error;
  }

  async listForUser(_ownerId: string, entityType?: string): Promise<Item[]> {
    // RLS restricts the result to the signed-in user's rows. When a type is
    // given the filter runs in SQL (corrections pack 2026-08-14 item 4); the
    // (owner_id, entity_type) index from migration 0001 covers it, so a
    // service list is never a full scan of the user's account.
    //
    // PostgREST caps a response at max-rows (1000 by default), and it does so
    // SILENTLY: you get a short array, not an error. Past that cap a user's
    // tasks or events would simply start disappearing with nothing in the
    // logs. Page explicitly with range() until a short page proves the end.
    const PAGE = 1000;
    const out: Item[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = this.db
        .from("item")
        .select(ITEM_COLUMNS);
      if (entityType !== undefined) q = q.eq("entity_type", entityType);
      const { data: rows, error } = await q
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const page = (rows ?? []) as ItemRow[];
      out.push(...page.map(toItem));
      if (page.length < PAGE) break;
    }
    return out;
  }

  // UP-LAUNCH-13: Fetch the user's subscription tier from the server.
  // Returns 'god' (unlimited), 'paid' (subscription active), or 'free' (trial/unpaid).
  // Defaults to 'free' if not set.
  async getSubscriptionTier(): Promise<string> {
    const { data: tier, error } = await this.db.rpc("get_subscription_tier");
    if (error) {
      // If the RPC doesn't exist yet (migration not applied), default to 'free'.
      if (isMissingFunction(error)) return "free";
      throw error;
    }
    return tier ?? "free";
  }
}

// Convenience factory. Pass an access token (Supabase Auth session) so RLS sees
// the signed-in user. At Milestone B this swaps to a Clerk-issued JWT with no
// change to the adapter, only to how the client is constructed and the RLS
// policy's identity claim (see README).
export function createSupabaseAdapter(
  url: string,
  anonKey: string,
  accessToken?: string
): SupabaseAdapter {
  const client = createClient(url, anonKey, {
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return new SupabaseAdapter(client);
}
