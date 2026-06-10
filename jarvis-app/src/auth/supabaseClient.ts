import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Single auth client. Null when no credentials are set (sandbox / local dev with
// no backend); the UI handles that case. On device, set VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY and this becomes a real, session-persisting client.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
