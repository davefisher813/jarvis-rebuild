import { useEffect, useState } from "react";

// WHICH SIGN-IN PROVIDERS THE BACKEND HAS SWITCHED ON (Dave 2026-10-01).
//
// "Continue with Apple" was always on screen, but Apple is only usable once the
// Supabase project has it enabled, and that needs Dave's Apple Developer
// credentials entered in the dashboard, which is not code. Until then the
// button sent a tester's browser to a raw Supabase page:
//   {"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
// Supabase publishes exactly what it has switched on at GET /auth/v1/settings
// (public, needs only the anon key): { external: { apple: boolean, ... } }. The
// screen asks that and offers a provider only when the answer is a clear yes,
// so the button appears by itself the day Apple is enabled and not before. A
// failed or missing answer is "not offered": a dead button is worse than none.

export type ProviderFlags = Record<string, boolean>;
type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function fetchProviderFlags(url: string | undefined, anonKey: string | undefined, doFetch: FetchLike = fetch as unknown as FetchLike): Promise<ProviderFlags | null> {
  if (!url || !anonKey) return null;
  try {
    const r = await doFetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!r.ok) return null;
    const j = (await r.json()) as { external?: unknown };
    if (!j.external || typeof j.external !== "object") return null;
    const out: ProviderFlags = {};
    for (const [k, v] of Object.entries(j.external as Record<string, unknown>)) out[k] = v === true;
    return out;
  } catch { return null; }
}

let cached: Promise<ProviderFlags | null> | null = null;
/** One ask per page load. */
export function providerFlags(): Promise<ProviderFlags | null> {
  if (!cached) {
    cached = fetchProviderFlags(import.meta.env.VITE_SUPABASE_URL as string | undefined, import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
  }
  return cached;
}
export function resetProviderFlagsForTests(): void { cached = null; }

/** True only once the backend has said this provider is on. */
export function useProviderEnabled(provider: string): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void providerFlags().then((f) => { if (live) setOn(f?.[provider] === true); });
    return () => { live = false; };
  }, [provider]);
  return on;
}

export const APPLE_UNAVAILABLE = "Apple sign-in is not switched on yet · Use email instead";

/** A provider that is not switched on, in the words of whichever layer said it. */
export function isUnsupportedProvider(e: unknown): boolean {
  const m = typeof e === "string" ? e : (e as { message?: unknown } | null | undefined)?.message;
  if (typeof m !== "string") return false;
  return /unsupported provider|provider is not enabled|validation_failed/i.test(m);
}

/** What a person should read when Apple sign-in fails: never the raw backend error. */
export function appleErrorMessage(e: unknown): string {
  if (isUnsupportedProvider(e)) return APPLE_UNAVAILABLE;
  return e instanceof Error && e.message ? e.message : "Couldn't reach Apple · Try again";
}
