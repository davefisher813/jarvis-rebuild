import { lazy, type ComponentType, type LazyExoticComponent } from "react";

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

/** Drop-in for React.lazy on every route/tab chunk. Same signature as
 *  React.lazy itself, including its `any`: the constraint is "a component",
 *  and each call site's own props stay fully typed through T. (This config
 *  has no no-explicit-any rule, so no disable comment -- naming a rule the
 *  config lacks is itself a lint ERROR here, caught 2026-08-31.) */
export function lazyWithRecovery<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => recoverImport(load));
}
