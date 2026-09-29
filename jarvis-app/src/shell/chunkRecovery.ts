import { createElement, lazy, type ComponentProps, type ComponentType } from "react";

// THE TAB THAT NEVER LOADED (Dave 2026-08-30, screenshot: the More tab
// showing the two-card Suspense skeleton forever, everything else fine).
//
// Every tab is a lazy() chunk. React.lazy memoizes the FIRST import promise
// for the life of the page: if that one fetch hangs on a bad cell link, or
// 404s because the phone opened a cached index.html whose hashed chunk names
// a deploy has since replaced, the tab is dead until a full reload -- and
// nothing on screen says so. The skeleton just sits there, which reads as
// "the page won't load", because it won't.
//
// The recovery ladder, tried in order:
//   1. the import itself, with a timeout so a hung fetch counts as a failure
//      instead of an eternal skeleton;
//   2. one retry after a short pause (a flaky link's usual cure);
//   3. one whole-page reload, at most once per session (sessionStorage
//      guard, so a genuinely broken deploy cannot reload-loop) -- a reload
//      refetches index.html, which is how a stale build heals itself;
//   4. give up loudly: throw, so the root ErrorBoundary shows its Reload
//      card instead of a skeleton pretending to be progress.
//
// The core is a plain function taking its effects as arguments so the ladder
// is testable without faking React, modules, or a real location.reload.

export const RELOADED_KEY = "jarvis.chunk.reloaded.v1";
const TIMEOUT_MS = 12_000;
const RETRY_PAUSE_MS = 1_200;
const FRESH_IMPORT_AFTER_MS = 1_000;

export interface RecoveryEffects {
  timeoutMs?: number;
  retryPauseMs?: number;
  reload?: () => void;
  storage?: Pick<Storage, "getItem" | "setItem">;
}

function sessionStore(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("chunk load timed out")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function recoverImport<T>(load: () => Promise<T>, fx: RecoveryEffects = {}): Promise<T> {
  const timeoutMs = fx.timeoutMs ?? TIMEOUT_MS;
  const retryPauseMs = fx.retryPauseMs ?? RETRY_PAUSE_MS;
  const storage = fx.storage ?? sessionStore();
  const reload = fx.reload ?? (() => window.location.reload());

  try {
    return await withTimeout(load(), timeoutMs);
  } catch {
    // Rung 2: a fresh import() call, not the memoized one -- the whole point.
    await pause(retryPauseMs);
    try {
      return await withTimeout(load(), timeoutMs);
    } catch (second) {
      let alreadyReloaded = false;
      try { alreadyReloaded = storage?.getItem(RELOADED_KEY) === "1"; } catch { /* treat as not reloaded */ }
      if (!alreadyReloaded) {
        try { storage?.setItem(RELOADED_KEY, "1"); } catch { /* still reload; worst case the guard is lost */ }
        reload();
        // The page is going away. Never settle, so React keeps the skeleton
        // up for the moment the reload takes instead of flashing an error.
        return new Promise<T>(() => {});
      }
      throw second instanceof Error ? second : new Error("chunk load failed");
    }
  }
}

/** A route/tab/sheet chunk that survives a bad first load.
 *
 *  Two things React.lazy alone gets wrong (first-tap crash on Quick Capture,
 *  audit 2026-09-29):
 *   - it memoizes a REJECTED import for the life of the page, so once the
 *     ladder above gave up, every later tap re-threw the same error until a
 *     full reload. Here a failure swaps in a fresh lazy(), so the next
 *     mount (a second tap, a boundary remount) starts a clean import.
 *   - the first tap was also the first fetch. `preload()` lets the shell
 *     warm the chunk after boot (best effort, errors ignored: the real
 *     mount still runs the full recovery ladder).
 *
 *  Same signature as React.lazy, including its `any`: the constraint is "a
 *  component", and each call site's own props stay fully typed through T.
 *  (This config has no no-explicit-any rule, so no disable comment -- naming
 *  a rule the config lacks is itself a lint ERROR here, caught 2026-08-31.) */
export function lazyWithRecovery<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): ((props: ComponentProps<T>) => ReturnType<typeof createElement>) & { preload: () => void } {
  // A failed lazy stays in place for a beat: React re-renders the suspended
  // tree the instant the rejection lands, and swapping right then would make
  // a permanently broken chunk retry forever instead of reaching the boundary.
  // A tap a moment later (well past that re-render) gets a clean import.
  let failedAt = 0;
  const make = () =>
    lazy(() =>
      recoverImport(load).catch((e: unknown) => {
        failedAt = Date.now();
        throw e;
      }),
    );
  let current = make();
  const Wrapper = (props: ComponentProps<T>) => {
    if (failedAt && Date.now() - failedAt > FRESH_IMPORT_AFTER_MS) {
      current = make();
      failedAt = 0;
    }
    return createElement(current as ComponentType<any>, props);
  };
  Wrapper.preload = () => {
    load().catch(() => {});
  };
  return Wrapper;
}
