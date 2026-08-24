import { Store, InMemoryAdapter, createSupabaseAdapter } from "@core";
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

// Builds the data store. With Supabase env present, uses the real adapter
// wrapped in the stale-while-revalidate preload cache, with the signed-in
// user's access token. Otherwise an in-memory store for local dev and the
// self-contained demo build (data resets on reload, no network; the demo
// gets no persisted cache on purpose, it must reset).
export function makeStore(accessToken?: string): Store {
  if (url && anonKey) {
    const real = createSupabaseAdapter(url, anonKey, accessToken);
    const cached = new CachedAdapter(real, notifyFreshLists);
    return new Store(cached);
  }
  return new Store(new InMemoryAdapter());
}
