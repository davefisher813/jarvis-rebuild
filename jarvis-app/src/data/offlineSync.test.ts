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

  // HMN-F-08 (2026-09-05): the health queue used to drain only on the next
  // health tap. It rides the same online signal now, and a launch that is
  // already online flushes once up front.
  describe("alsoFlush (the health queue)", () => {
    it("runs once at wiring time when the launch is online, and on every online event after", () => {
      onlineGetter(true);
      const store = new Store(new InMemoryAdapter());
      const flush = vi.fn();
      wireOfflineSync(store, flush);
      expect(flush).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
      expect(flush).toHaveBeenCalledTimes(3);
    });

    it("does not run at wiring time when the launch is offline; the first online event runs it", () => {
      onlineGetter(false);
      const store = new Store(new InMemoryAdapter());
      const flush = vi.fn();
      wireOfflineSync(store, flush);
      expect(flush).not.toHaveBeenCalled();
      window.dispatchEvent(new Event("online"));
      expect(flush).toHaveBeenCalledTimes(1);
    });

    it("still runs when the core reconnect itself rejects", async () => {
      onlineGetter(true);
      const store = new Store(new InMemoryAdapter());
      vi.spyOn(store, "reconnect").mockRejectedValue(new Error("dropped again"));
      const flush = vi.fn();
      wireOfflineSync(store, flush);
      window.dispatchEvent(new Event("online"));
      expect(flush).toHaveBeenCalledTimes(2);
      await new Promise((r) => setTimeout(r, 0));
    });
  });
});

// PLUMB-F-09 (2026-09-05): the browser's events were the only signal, and on
// iOS navigator.onLine only flips when no interface is up at all. The Store
// notices a network-class write failure itself now; this is the other half,
// the clock the core deliberately does not own.
describe("the backoff retry after a write finds the signal gone", () => {
  function wireCapturingDrop(store: Store, alsoFlush?: () => void) {
    let dropped: (() => void) | null = null;
    const real = store.onDropped.bind(store);
    vi.spyOn(store, "onDropped").mockImplementation((fn) => { dropped = fn; real(fn); });
    const stop = wireOfflineSync(store, alsoFlush);
    return { stop, drop: () => dropped?.() };
  }

  it("retries the queue on a growing wait until it lands, with only one retry in flight", async () => {
    vi.useFakeTimers();
    try {
      onlineGetter(true);
      const store = new Store(new InMemoryAdapter());
      const reconnect = vi.spyOn(store, "reconnect").mockRejectedValue(new Error("still down"));
      const { drop } = wireCapturingDrop(store);

      drop();
      drop(); // a second failed write while a retry is already pending changes nothing
      expect(reconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(reconnect).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(reconnect).toHaveBeenCalledTimes(1);

      // Still down, so the next wait is longer, not another two seconds.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(reconnect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(reconnect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a drain that lands stops the retries, and the next drop starts short again", async () => {
    vi.useFakeTimers();
    try {
      onlineGetter(true);
      const store = new Store(new InMemoryAdapter());
      const reconnect = vi.spyOn(store, "reconnect").mockResolvedValue(undefined);
      const { drop } = wireCapturingDrop(store);

      drop();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(reconnect).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(reconnect).toHaveBeenCalledTimes(1); // nothing left to chase

      drop();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(reconnect).toHaveBeenCalledTimes(2); // back to the short wait
    } finally {
      vi.useRealTimers();
    }
  });

  it("a real online event cuts the wait short and does not leave the old timer armed", () => {
    vi.useFakeTimers();
    try {
      onlineGetter(true);
      const store = new Store(new InMemoryAdapter());
      const reconnect = vi.spyOn(store, "reconnect").mockResolvedValue(undefined);
      const { drop } = wireCapturingDrop(store);
      drop();
      window.dispatchEvent(new Event("online"));
      expect(reconnect).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(600_000);
      expect(reconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the cleanup stops the retries and unhooks the store", () => {
    vi.useFakeTimers();
    try {
      onlineGetter(true);
      const store = new Store(new InMemoryAdapter());
      const reconnect = vi.spyOn(store, "reconnect").mockResolvedValue(undefined);
      const { stop, drop } = wireCapturingDrop(store);
      drop();
      stop();
      vi.advanceTimersByTime(600_000);
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
