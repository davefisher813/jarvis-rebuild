// THE TAB THAT NEVER LOADED (2026-08-30). The ladder: import with a timeout,
// one retry, one reload per session, then a loud throw. Each rung tested with
// its effects injected, so no fake React and no real page reload.

import { describe, it, expect } from "vitest";
import { recoverImport, RELOADED_KEY } from "./chunkRecovery";

function memStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    dump: () => Object.fromEntries(m),
  };
}

const FAST = { timeoutMs: 60, retryPauseMs: 5 };

describe("chunk recovery ladder", () => {
  it("a healthy import resolves untouched, with no reload and no flag", async () => {
    const storage = memStorage();
    let reloads = 0;
    const out = await recoverImport(() => Promise.resolve("chunk"), { ...FAST, storage, reload: () => reloads++ });
    expect(out).toBe("chunk");
    expect(reloads).toBe(0);
    expect(storage.dump()).toEqual({});
  });

  it("one flaky failure is cured by the retry -- a NEW import call, not the memoized one", async () => {
    let calls = 0;
    const load = () => (++calls === 1 ? Promise.reject(new Error("net")) : Promise.resolve("chunk"));
    const out = await recoverImport(load, { ...FAST, storage: memStorage(), reload: () => {} });
    expect(out).toBe("chunk");
    expect(calls).toBe(2);
  });

  it("a HUNG import counts as a failure instead of an eternal skeleton", async () => {
    // First call never settles (the bug on Dave's phone); the retry works.
    let calls = 0;
    const load = () => (++calls === 1 ? new Promise<string>(() => {}) : Promise.resolve("chunk"));
    const out = await recoverImport(load, { ...FAST, storage: memStorage(), reload: () => {} });
    expect(out).toBe("chunk");
  });

  it("two failures trigger ONE reload and set the session guard", async () => {
    const storage = memStorage();
    let reloads = 0;
    const p = recoverImport(() => Promise.reject(new Error("gone")), { ...FAST, storage, reload: () => reloads++ });
    // The promise deliberately never settles while the page reloads; give the
    // ladder time to reach the reload rung, then assert on the effects.
    await new Promise((r) => setTimeout(r, 100));
    expect(reloads).toBe(1);
    expect(storage.dump()[RELOADED_KEY]).toBe("1");
    void p; // intentionally unsettled
  });

  it("with the guard already set, it throws to the error boundary instead of reload-looping", async () => {
    const storage = memStorage({ [RELOADED_KEY]: "1" });
    let reloads = 0;
    await expect(
      recoverImport(() => Promise.reject(new Error("still gone")), { ...FAST, storage, reload: () => reloads++ }),
    ).rejects.toThrow(/still gone/);
    expect(reloads, "a broken deploy must never reload forever").toBe(0);
  });
});
