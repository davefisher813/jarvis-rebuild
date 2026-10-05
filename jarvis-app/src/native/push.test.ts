// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { registerForRemotePush, refreshRemotePushToken, unregisterRemotePush, PUSH_TOKEN_KEY } from "./push";

// 2026-10-05: the phone's half of remote push. The sender is not built (needs
// Dave's APNs key), so the token is stored and nothing is shown.

function fakePlugin(over: { perm?: string; afterRequest?: string; token?: string; error?: string } = {}) {
  const listeners: Record<string, (v: never) => void> = {};
  const calls = { check: 0, request: 0, register: 0 };
  return {
    calls,
    plugin: {
      checkPermissions: async () => { calls.check++; return { receive: over.perm ?? "granted" }; },
      requestPermissions: async () => { calls.request++; return { receive: over.afterRequest ?? "granted" }; },
      register: async () => {
        calls.register++;
        queueMicrotask(() => {
          if (over.error) (listeners.registrationError as ((e: { error: string }) => void) | undefined)?.({ error: over.error });
          else (listeners.registration as ((t: { value: string }) => void) | undefined)?.({ value: over.token ?? "T".repeat(64) });
        });
      },
      addListener: async (event: string, fn: (v: never) => void) => { listeners[event] = fn; return { remove: async () => {} }; },
    },
  };
}
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m }; };

describe("remote push registration", () => {
  it("does nothing off the phone", async () => {
    const f = fakePlugin();
    expect(await registerForRemotePush({ isNative: () => false, plugin: f.plugin as never })).toBe("unavailable");
    expect(f.calls.check).toBe(0);
  });

  it("a person's own ask shows the permission dialog once, then stores the token on the account", async () => {
    const f = fakePlugin({ perm: "prompt" });
    const save = vi.fn(async () => {});
    const storage = mem();
    const r = await registerForRemotePush({ isNative: () => true, plugin: f.plugin as never, save, storage, environment: "development", build: "b7" });
    expect(r).toBe("registered");
    expect(f.calls.request).toBe(1);
    expect(save).toHaveBeenCalledWith("T".repeat(64), "development", "b7");
    expect(storage.getItem(PUSH_TOKEN_KEY)).toBe("T".repeat(64));
  });

  it("a refusal stores nothing and is not an error", async () => {
    const f = fakePlugin({ perm: "prompt", afterRequest: "denied" });
    const save = vi.fn(async () => {});
    expect(await registerForRemotePush({ isNative: () => true, plugin: f.plugin as never, save, storage: mem() })).toBe("denied");
    expect(save).not.toHaveBeenCalled();
    expect(f.calls.register).toBe(0);
  });

  it("the sign-in refresh NEVER asks: an undecided permission stays undecided", async () => {
    const f = fakePlugin({ perm: "prompt" });
    const save = vi.fn(async () => {});
    expect(await refreshRemotePushToken({ isNative: () => true, plugin: f.plugin as never, save, storage: mem() })).toBe("denied");
    expect(f.calls.request).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("the sign-in refresh re-stores the token when the person already said yes", async () => {
    const f = fakePlugin({ perm: "granted", token: "N".repeat(64) });
    const save = vi.fn(async () => {});
    expect(await refreshRemotePushToken({ isNative: () => true, plugin: f.plugin as never, save, storage: mem() })).toBe("registered");
    expect(save).toHaveBeenCalledWith("N".repeat(64), expect.any(String), expect.any(String));
  });

  it("a registration error or a failed save is 'failed', never a throw", async () => {
    const f = fakePlugin({ error: "no network" });
    expect(await refreshRemotePushToken({ isNative: () => true, plugin: f.plugin as never, save: async () => {}, storage: mem() })).toBe("failed");
    const g = fakePlugin();
    expect(await refreshRemotePushToken({ isNative: () => true, plugin: g.plugin as never, save: async () => { throw new Error("rls"); }, storage: mem() })).toBe("failed");
  });

  it("gives up if iOS never answers", async () => {
    const plugin = { checkPermissions: async () => ({ receive: "granted" }), requestPermissions: async () => ({ receive: "granted" }), register: async () => {}, addListener: async () => ({ remove: async () => {} }) };
    expect(await refreshRemotePushToken({ isNative: () => true, plugin: plugin as never, save: async () => {}, storage: mem(), timeoutMs: 20 })).toBe("failed");
  });

  it("sign-out removes this phone's token from the account and forgets it", async () => {
    const storage = mem();
    storage.setItem(PUSH_TOKEN_KEY, "X".repeat(64));
    const remove = vi.fn(async () => {});
    await unregisterRemotePush({ remove, storage, isNative: () => true });
    expect(remove).toHaveBeenCalledWith("X".repeat(64));
    expect(storage.getItem(PUSH_TOKEN_KEY)).toBeNull();
  });

  it("sign-out with no stored token does nothing, and a failed removal does not throw", async () => {
    const remove = vi.fn(async () => {});
    await unregisterRemotePush({ remove, storage: mem() });
    expect(remove).not.toHaveBeenCalled();
    const s = mem(); s.setItem(PUSH_TOKEN_KEY, "Y".repeat(64));
    await expect(unregisterRemotePush({ remove: async () => { throw new Error("offline"); }, storage: s })).resolves.toBeUndefined();
  });
});
