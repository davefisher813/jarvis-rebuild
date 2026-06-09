import {
  Store,
  InMemoryAdapter,
  createSupabaseAdapter,
  type DataAdapter,
} from "@core";

// One place that builds the data engine for the app.
// On device: set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY, and pass the
// signed-in user's access token (wired in the auth step) to use the real
// backend. With no creds (sandbox / local dev) it falls back to the in-memory
// adapter so the shell still runs. The Store API is identical either way.

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function makeStore(accessToken?: string): Store {
  let adapter: DataAdapter;
  if (url && anonKey) {
    adapter = createSupabaseAdapter(url, anonKey, accessToken);
  } else {
    adapter = new InMemoryAdapter();
  }
  return new Store(adapter);
}

// Default store for local dev. Auth will rebuild this with the user's token.
export const store = makeStore();
