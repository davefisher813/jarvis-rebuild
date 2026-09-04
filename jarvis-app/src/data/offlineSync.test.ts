// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { wireOfflineSync } from "./offlineSync";

// S3-Q14 (2026-09-04): "There is no online or offline listener for user data
// anywhere." The one that existed only flushed the analytics sink. This is
// the real one, wired to the browser's own connectivity events.

function onlineGetter(value: boolean) {
  return vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}

afterEach(() => vi.restoreAllMocks());

describe("wireOfflineSync", () => {
  it("goes offline on the browser's offline event", () => {
    onlineGetter(true);
    const store = new Store(new InMemoryAdapter());
    const goOffline = vi.spyOn(store, "goOffline");
    wireOfflineSync(store);
    window.dispatchEvent(new Event("offline"));
    expect(goOffline).toHaveBeenCalledTimes(1);
  });

  it("reconnects on the browser's online event", () => {
    onlineGetter(true);
    const store = new Store(new InMemoryAdapter());
    const reconnect = vi.spyOn(store, "reconnect");
    wireOfflineSync(store);
    window.dispatchEvent(new Event("online"));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("a launch that starts offline (airplane mode before the app ever opens) goes offline immediately, with no event to wait for", () => {
    onlineGetter(false);
    const store = new Store(new InMemoryAdapter());
    const goOffline = vi.spyOn(store, "goOffline");
    wireOfflineSync(store);
    expect(goOffline).toHaveBeenCalledTimes(1);
  });

  it("a launch that starts online stays online, no spurious goOffline", () => {
    onlineGetter(true);
    const store = new Store(new InMemoryAdapter());
    const goOffline = vi.spyOn(store, "goOffline");
    wireOfflineSync(store);
    expect(goOffline).not.toHaveBeenCalled();
  });

  it("the returned cleanup stops listening", () => {
    onlineGetter(true);
    const store = new Store(new InMemoryAdapter());
    const goOffline = vi.spyOn(store, "goOffline");
    const stop = wireOfflineSync(store);
    stop();
    window.dispatchEvent(new Event("offline"));
    expect(goOffline).not.toHaveBeenCalled();
  });

  it("a reconnect that fails (network dropped again immediately) never becomes an unhandled rejection", async () => {
    onlineGetter(true);
    const store = new Store(new InMemoryAdapter());
    vi.spyOn(store, "reconnect").mockRejectedValue(new Error("dropped again"));
    wireOfflineSync(store);
    expect(() => window.dispatchEvent(new Event("online"))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0)); // let the rejection's .catch settle
  });
});
