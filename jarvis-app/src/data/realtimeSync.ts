import type { SupabaseClient } from "@supabase/supabase-js";
import type { Item } from "@core";
import { notifyFreshLists } from "./store";
import { readPreload, writePreload } from "./preloadCache";
import { KNOWN_TYPES } from "./CachedAdapter";

// UP-PLAT-06 (2026-09-06), option B, half two: WHILE THE APP IS OPEN, THE
// OTHER DEVICE'S CHANGE ARRIVES.
//
// The resume refresh covers picking the phone up. This covers the laptop and
// the phone being open at the same time, which is the whole multi-device
// premise of Track 3 and had no push path at all: a grep for postgres_changes
// found nothing in the app.
//
// One channel, one table, filtered to this user's own rows, on the auth
// client that already exists (auth/supabaseClient.ts). Supabase authorises
// every event per subscriber under the same RLS the REST path uses, so this
// can only ever deliver rows the caller could already read.
//
// A DELETE event carries only the primary key unless the table is set to
// `replica identity full`, and a FILTERED delete is dropped entirely without
// it, which is why migration 0034 exists. Until Dave runs it, deletes made on
// another device simply do not arrive live and are picked up by the next
// resume refresh or list, exactly as they were before this file.

// The shape Postgres sends for an `item` row. Snake case, because this is the
// database's own payload and not the app's Item.
interface ItemRow {
  id?: unknown;
  owner_id?: unknown;
  entity_type?: unknown;
  data?: unknown;
  updated_at?: unknown;
}

export interface RealtimeChange {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: ItemRow;
  old?: ItemRow;
}

function epoch(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function rowToItem(r: ItemRow, ownerId: string): Item | null {
  if (typeof r.id !== "string" || typeof r.entity_type !== "string") return null;
  if (!r.data || typeof r.data !== "object") return null;
  return {
    id: r.id,
    ownerId,
    entityType: r.entity_type,
    data: r.data as Item["data"],
    serverTime: epoch(r.updated_at),
  };
}

/**
 * Applies one change to the preload cache and returns the entity type to
 * repaint, or null when nothing changed. Pure apart from the cache, so the
 * interesting half is testable without a socket.
 *
 * THE RULE THAT KEEPS THIS SAFE: an event older than what the cache already
 * holds is dropped. The local row may be this device's own optimistic write
 * (CachedAdapter writes through on every mutation with a fresh serverTime),
 * and an event that crossed it in flight would put the old value back on
 * screen, which is precisely the "it came back" feel this rebuild exists to
 * kill. Same doctrine as CachedAdapter's write counter.
 */
export function applyRealtimeChange(ownerId: string, change: RealtimeChange): string | null {
  if (change.eventType === "DELETE") {
    // Only the key arrives unless the table is `replica identity full`
    // (migration 0034), and the key alone does not say which type it was, so
    // this walks the cached types the same way CachedAdapter's delete does.
    const id = typeof change.old?.id === "string" ? change.old.id : null;
    if (!id) return null;
    const type = typeof change.old?.entity_type === "string" ? change.old.entity_type : null;
    for (const t of type ? [type] : KNOWN_TYPES) {
      const items = readPreload(ownerId, t);
      if (!items || !items.some((i) => i.id === id)) continue;
      writePreload(ownerId, t, items.filter((i) => i.id !== id));
      return t;
    }
    return null;
  }

  const item = change.new ? rowToItem(change.new, ownerId) : null;
  if (!item) return null;
  const cached = readPreload(ownerId, item.entityType);
  // Nothing cached for this type means nothing on screen is answering from a
  // stale copy; the surface's own list is already the truth.
  if (!cached) return null;
  const idx = cached.findIndex((i) => i.id === item.id);
  if (idx >= 0) {
    if (item.serverTime <= cached[idx]!.serverTime) return null; // older than what we hold
    const next = [...cached];
    next[idx] = item;
    writePreload(ownerId, item.entityType, next);
  } else {
    writePreload(ownerId, item.entityType, [...cached, item]);
  }
  return item.entityType;
}

/**
 * Subscribes to this user's own rows for as long as the app is in the
 * foreground. Returns the unsubscribe; a null client (the demo and local
 * builds have no backend) makes the whole thing a no-op, same contract as
 * every other optional seam in this folder.
 */
export function wireRealtime(
  client: SupabaseClient | null,
  ownerId: string,
  notify: (t: string) => void = notifyFreshLists,
): () => void {
  if (!client || !ownerId) return () => {};
  const channel = client
    .channel(`item:${ownerId}`)
    .on(
      // The typed overload for postgres_changes is not exported by
      // supabase-js in a form this signature can name, so the event name is
      // asserted here and the payload is validated in applyRealtimeChange,
      // where it is data from the network like any other.
      "postgres_changes" as never,
      { event: "*", schema: "public", table: "item", filter: `owner_id=eq.${ownerId}` } as never,
      ((payload: RealtimeChange) => {
        try {
          const type = applyRealtimeChange(ownerId, payload);
          if (type) notify(type);
        } catch { /* a bad payload is never worth a crash on a live screen */ }
      }) as never,
    )
    .subscribe();
  return () => { void client.removeChannel(channel); };
}
