// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useWakeLock } from "./useWakeLock";

// S5-Q30 (2026-09-04): the screen lock, lifted out of ConditioningFace's own
// inline request into one shared hook. jsdom's navigator carries no
// wakeLock property at all, so every test here installs and removes its own
// fake -- the real-browser path (present, requests, releases) and the
// degrade path (absent, does nothing, never throws) both need covering.

type FakeLock = { release: () => Promise<void> };

function installFakeWakeLock() {
  const release = vi.fn<() => Promise<void>>(() => Promise.resolve());
  // Built up front, not inside the mock factory: the mock's own call happens
  // asynchronously once the hook's effect runs, and a resolver assigned only
  // then would arrive too late for a caller that grabbed this return value
  // first.
  let resolve: (lock: FakeLock) => void = () => {};
  const pending = new Promise<FakeLock>((res) => { resolve = res; });
  const request = vi.fn<() => Promise<FakeLock>>(() => pending);
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
  return { request, release, resolveRequest: (lock: FakeLock) => resolve(lock) };
}

function removeFakeWakeLock(): void {
  Object.defineProperty(navigator, "wakeLock", { value: undefined, configurable: true });
}

describe("useWakeLock", () => {
  afterEach(() => { removeFakeWakeLock(); vi.restoreAllMocks(); });

  it("requests a screen lock on mount and releases it on unmount", async () => {
    const { request, release, resolveRequest } = installFakeWakeLock();
    const { unmount } = renderHook(() => useWakeLock());
    expect(request).toHaveBeenCalledWith("screen");
    resolveRequest({ release });
    await Promise.resolve(); await Promise.resolve();
    unmount();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never requests when active is false", () => {
    const { request } = installFakeWakeLock();
    renderHook(() => useWakeLock(false));
    expect(request).not.toHaveBeenCalled();
  });

  it("releases a lock that resolves after the component already unmounted, so nothing leaks", async () => {
    const { release, resolveRequest } = installFakeWakeLock();
    const { unmount } = renderHook(() => useWakeLock());
    unmount();
    resolveRequest({ release });
    await Promise.resolve(); await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("degrades silently with no Wake Lock API at all: no crash, nothing to release", () => {
    removeFakeWakeLock();
    expect(() => {
      const { unmount } = renderHook(() => useWakeLock());
      unmount();
    }).not.toThrow();
  });
});
