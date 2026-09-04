import { Store, InMemoryAdapter, createSupabaseAdapter, type QueuedOp, type StorePersistence } from "@core";
import { CachedAdapter } from "./CachedAdapter";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// True on device when Supabase env is set; false in local/demo builds.
export const backendConfigured = !!(url && anonKey);

// Preload repaint notifications (addendum locked principle 2): fires with the
// entity type whenever a background refresh found real changes behind a list
// that answered from the persisted cache. Surfaces that want the repaint
// subscribe; everything else just reloads on its own interactions as before.
const freshSubs = new Set<(entityType: string) => void>();
export function subscribeFreshLists(fn: (entityType: string) => void): () => void {
  freshSubs.add(fn);
  return () => freshSubs.delete(fn);
}

// The dispatch half, exported rather than an inline closure inside makeStore
// (2026-08-24). It was unreachable from anywhere else, which meant the only
// way to test the notification was to build a real Supabase-backed store, so
// in practice nobody ever did: this pipe had zero subscribers from the day it
// shipped and nothing noticed.
export function notifyFreshLists(entityType: string): void {
  for (const fn of freshSubs) fn(entityType);
}

// S3-Q14 (2026-09-04): "Nothing is held when the signal drops." The offline
// queue itself lives in localStorage (same convention as every other
// persisted store in this app: JSON in, JSON out, a corrupt or missing value
// is just an empty queue rather than a crash). Keyed per user, so signing
// out and a different person signing in on the same device never replays
// one person's held writes as another's.
export function queuePersistence(
  userId: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): StorePersistence {
  const key = `jarvis.store.queue.${userId}.v1`;
  return {
    load(): QueuedOp[] {
      try {
        const raw = JSON.parse(storage.getItem(key) || "[]") as unknown;
        return Array.isArray(raw) ? (raw as QueuedOp[]) : [];
      } catch {
        return [];
      }
    },
    save(queue: QueuedOp[]): void {
      try { storage.setItem(key, JSON.stringify(queue)); } catch { /* private mode */ }
    },
  };
}

// Builds the data store. With Supabase env present, uses the real adapter
// wrapped in the stale-while-revalidate preload cache, with the signed-in
// user's access token, and (given a userId) a persisted offline queue so a
// held write survives the app being killed. Otherwise an in-memory store for
// local dev and the self-contained demo build (data resets on reload, no
// network; the demo gets no persisted queue any more than it gets a
// persisted cache -- restarting it is supposed to reset everything).
export function makeStore(accessToken?: string, userId?: string): Store {
  if (url && anonKey) {
    const real = createSupabaseAdapter(url, anonKey, accessToken);
    const cached = new CachedAdapter(real, notifyFreshLists);
    return new Store(cached, userId ? queuePersistence(userId) : undefined);
  }
  return new Store(new InMemoryAdapter());
}
