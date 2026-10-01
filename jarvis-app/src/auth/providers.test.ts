import { describe, it, expect, vi } from "vitest";
import { fetchProviderFlags, isUnsupportedProvider, appleErrorMessage, APPLE_UNAVAILABLE } from "./providers";

// DEMO WEEK (Dave 2026-10-01): Apple is only usable once the Supabase project has
// it enabled. The backend publishes what is on at /auth/v1/settings; the sign-in
// screen offers a provider only on a clear yes.

const ok = (body: unknown) => async () => ({ ok: true, json: async () => body });

describe("fetchProviderFlags", () => {
  it("reads which providers the backend has switched on", async () => {
    const f = vi.fn((_url: string, _init?: { headers?: Record<string, string> }) => ok({ external: { email: true, apple: false, google: true } })());
    const flags = await fetchProviderFlags("https://x.supabase.co/", "anon", f as never);
    expect(flags).toEqual({ email: true, apple: false, google: true });
    expect(f.mock.calls[0]![0]).toBe("https://x.supabase.co/auth/v1/settings");
    expect(f.mock.calls[0]![1]!.headers).toEqual({ apikey: "anon" });
  });

  it("apple true is the only thing that turns it on", async () => {
    expect((await fetchProviderFlags("https://x.co", "k", ok({ external: { apple: true } }) as never))!.apple).toBe(true);
    expect((await fetchProviderFlags("https://x.co", "k", ok({ external: { apple: "true" } }) as never))!.apple).toBe(false);
  });

  it("no answer is a no: a missing config, a failed call, a thrown call or a strange body all return null", async () => {
    expect(await fetchProviderFlags(undefined, "k")).toBeNull();
    expect(await fetchProviderFlags("https://x.co", undefined)).toBeNull();
    expect(await fetchProviderFlags("https://x.co", "k", (async () => ({ ok: false, json: async () => ({}) })) as never)).toBeNull();
    expect(await fetchProviderFlags("https://x.co", "k", (async () => { throw new Error("offline"); }) as never)).toBeNull();
    expect(await fetchProviderFlags("https://x.co", "k", ok({ nope: 1 }) as never)).toBeNull();
  });
});

describe("the words a person reads", () => {
  it("recognises 'Unsupported provider' in whichever layer said it", () => {
    expect(isUnsupportedProvider(new Error("Unsupported provider: provider is not enabled"))).toBe(true);
    expect(isUnsupportedProvider({ message: "x" })).toBe(false);
    expect(isUnsupportedProvider({ message: "Unsupported provider: provider is not enabled" })).toBe(true);
    expect(isUnsupportedProvider(new Error('{"code":400,"error_code":"validation_failed"}'))).toBe(true);
    expect(isUnsupportedProvider(new Error("Network request failed"))).toBe(false);
  });
  it("turns the raw backend error into what to do instead, and leaves honest errors alone", () => {
    expect(appleErrorMessage(new Error("Unsupported provider: provider is not enabled"))).toBe(APPLE_UNAVAILABLE);
    expect(appleErrorMessage(new Error("Network request failed"))).toBe("Network request failed");
    expect(appleErrorMessage(undefined)).toBe("Couldn't reach Apple · Try again");
    expect(APPLE_UNAVAILABLE).toMatch(/email/i);
  });
});
