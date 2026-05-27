import { Store, InMemoryAdapter, createSupabaseAdapter } from "@core";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// True on device when Supabase env is set; false in local/demo builds.
export const backendConfigured = !!(url && anonKey);

// Builds the data store. With Supabase env present, uses the real adapter with
// the signed-in user's access token. Otherwise an in-memory store for local dev
// and the self-contained demo build (data resets on reload, no network).
export function makeStore(accessToken?: string): Store {
  if (url && anonKey) {
    return new Store(createSupabaseAdapter(url, anonKey, accessToken));
  }
  return new Store(new InMemoryAdapter());
}
