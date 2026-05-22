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
  };
}

export class SupabaseAdapter implements DataAdapter {
  constructor(private readonly db: SupabaseClient) {}

  async create(_ownerId: string, entityType: string, data: ItemData): Promise<string> {
    // owner_id defaults to auth.uid() in the schema; RLS with-check validates it.
    const { data: row, error } = await this.db
      .from("item")
      .insert({ entity_type: entityType, data })
      .select("id")
      .single();
    if (error) throw error;
    return (row as { id: string }).id;
  }

  async read(_ownerId: string, id: string): Promise<Item | null> {
    // RLS returns no row if the caller does not own it, so this is null-safe
    // for both missing and not-owned ids.
    const { data: row, error } = await this.db
      .from("item")
      .select("id, owner_id, entity_type, data, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return row ? toItem(row as ItemRow) : null;
  }

  async apply(
    _ownerId: string,
    id: string,
    patch: ItemData,
    serverTime?: ServerTime
  ): Promise<boolean> {
    // The live server owns time, so an explicit serverTime (used only by tests
    // to reproduce exact orderings) is ignored here; the trigger stamps
    // updated_at monotonically on apply.
    void serverTime;
    // Server-side atomic JSONB merge inside RLS. Returns true if a row the
    // caller owns was updated; false for missing or not-owned ids (D6, D9).
    const { data: applied, error } = await this.db.rpc("item_apply_patch", {
      p_id: id,
      p_patch: patch,
    });
    if (error) throw error;
    return applied === true;
  }

  async del(_ownerId: string, id: string): Promise<void> {
    // RLS makes deleting a missing or not-owned id a safe no-op (D4, D5, D6, D9).
    const { error } = await this.db.from("item").delete().eq("id", id);
    if (error) throw error;
  }

  async listForUser(_ownerId: string): Promise<Item[]> {
    // RLS restricts the result to the signed-in user's rows.
    const { data: rows, error } = await this.db
      .from("item")
      .select("id, owner_id, entity_type, data, updated_at");
    if (error) throw error;
    return (rows as ItemRow[]).map(toItem);
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
