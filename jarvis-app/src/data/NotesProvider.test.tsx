// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider, useHealth, useStore } from "./NotesProvider";
import { queueHealthLog, readPending } from "../health/offlineQueue";
import type { HealthService } from "../health/HealthService";

// HMN-F-08 (2026-09-05): "Health offline queue drains only on the next
// health tap." A Took It whose write dropped sat in localStorage until the
// next time any health logger was tapped, which can be days. The provider
// now flushes the health queue once when it mounts online, and on every
// online event (offlineSync.test.ts covers the event half).

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("NotesProvider: the health queue drains at mount", () => {
  it("a health log left pending by an earlier session reaches the store without another tap", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    queueHealthLog({ entityType: "health_took_it", data: { category: "medication", at: 1725000000000 } });
    expect(readPending()).toHaveLength(1);
    let svc: HealthService | null = null;
    function Grab() { svc = useHealth(); return null; }
    render(<NotesProvider userId="u1"><Grab /></NotesProvider>);
    await waitFor(() => expect(readPending()).toHaveLength(0));
    const rows = await svc!.listTookIt();
    expect(rows.map((r) => r.data.at)).toEqual([1725000000000]);
  });

  it("a launch that is offline leaves the queue where it is", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    queueHealthLog({ entityType: "health_took_it", data: { category: "medication", at: 1 } });
    render(<NotesProvider userId="u1"><div /></NotesProvider>);
    await new Promise((r) => setTimeout(r, 20));
    expect(readPending()).toHaveLength(1);
  });
});

// Phase 0 D4 (2026-10-10): the trust checkpoint's doors read
// useStore()?.pending(). Proving the offline path needs a Store built on an
// adapter the test controls, so the provider takes one when given and builds
// its own (makeStore) otherwise. Production never passes it.
describe("NotesProvider: the store prop is a test seam", () => {
  function grabStore() {
    let got: Store | null | undefined;
    function Grab() { got = useStore(); return null; }
    return { Grab, store: () => got };
  }

  it("a store passed in is the store every hook sees", () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const mine = new Store(new InMemoryAdapter());
    const { Grab, store } = grabStore();
    render(<NotesProvider userId="u1" store={mine}><Grab /></NotesProvider>);
    expect(store()).toBe(mine);
  });

  it("without the prop, the provider builds its own", () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const notMine = new Store(new InMemoryAdapter());
    const { Grab, store } = grabStore();
    render(<NotesProvider userId="u1"><Grab /></NotesProvider>);
    expect(store()).not.toBeNull();
    expect(store()).not.toBe(notMine);
  });

  it("a store held offline answers pending through the hook, which is what the doors read", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true);
    const mine = new Store(new InMemoryAdapter());
    mine.goOffline();
    const { Grab, store } = grabStore();
    render(<NotesProvider userId="u1" store={mine}><Grab /></NotesProvider>);
    expect(store()!.pending()).toBe(true);
    await mine.reconnect();
    expect(store()!.pending()).toBe(false);
  });
});
