import { describe, it, expect } from "vitest";
import { Store, InMemoryAdapter, type SyncState } from "@core";
import { syncLine, syncedAgo } from "./useSyncState";

// UP-PLAT-05 (2026-09-06): "A sync line that tells the truth." The Account
// Sync card said a hardcoded "On" whatever was happening, and the Store's own
// queueLen() had been read by nothing but spec harnesses since S3-Q14. These
// cover the two halves: the Store now says what it knows, and the one
// renderer never says more than that.

const NOW = new Date("2026-09-06T10:00:00").getTime();
const state = (over: Partial<SyncState> = {}): SyncState => ({ online: true, queued: 0, lastSyncedAt: null, ...over });

describe("the line only ever states facts", () => {
  it("offline with nothing held is one word", () => {
    expect(syncLine(state({ online: false }), NOW)).toBe("Offline");
  });

  // The capital behind a leading number is the house rule (shared/casing's
  // capAfterNumber, and the law test that enforces it): "14 Emails need you".
  it("offline with writes held names the count", () => {
    expect(syncLine(state({ online: false, queued: 3 }), NOW)).toBe("Offline · 3 Changes waiting");
    expect(syncLine(state({ online: false, queued: 1 }), NOW)).toBe("Offline · 1 Change waiting");
  });

  it("online and caught up, having synced, says when", () => {
    expect(syncLine(state({ lastSyncedAt: NOW - 2 * 60000 }), NOW)).toBe("Last synced 2 min ago");
  });

  it("online with nothing sent yet says so, rather than inventing a time", () => {
    // A launch where the user has only read: nothing has left the phone, and
    // "Last synced" would be a claim about a moment that never happened.
    expect(syncLine(state(), NOW)).toBe("Nothing waiting");
  });

  it("waiting and synced is both facts, in that order", () => {
    expect(syncLine(state({ queued: 3, lastSyncedAt: NOW - 120000 }), NOW))
      .toBe("3 Changes waiting · Last synced 2 min ago");
  });

  it("under a minute is just now, never zero minutes", () => {
    expect(syncedAgo(NOW - 5000, NOW)).toBe("just now");
    expect(syncedAgo(NOW - 90 * 60000, NOW)).toBe("1 hour ago");
    expect(syncedAgo(NOW - 5 * 3600000, NOW)).toBe("5 hours ago");
  });
});

describe("the Store says what it knows (UP-PLAT-05)", () => {
  const store = () => new Store(new InMemoryAdapter());

  it("a subscriber hears the current state immediately, so nothing renders unknown", () => {
    const seen: SyncState[] = [];
    const off = store().subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ online: true, queued: 0, lastSyncedAt: null });
    off();
  });

  it("going offline, queueing a write, and draining are each announced", async () => {
    const s = store();
    const seen: SyncState[] = [];
    const off = s.subscribe((x) => seen.push({ ...x }));

    s.goOffline();
    expect(seen.at(-1)!.online).toBe(false);

    await s.update("u1", "missing", { text: "held" });
    expect(seen.at(-1)!.queued).toBe(1);

    await s.reconnect();
    const last = seen.at(-1)!;
    expect(last.online).toBe(true);
    expect(last.queued).toBe(0);
    // The drain finished, so something really did leave the phone.
    expect(last.lastSyncedAt).not.toBeNull();
    off();
  });

  it("a write that lands online stamps the sync time", async () => {
    const s = store();
    expect(s.syncState().lastSyncedAt).toBeNull();
    await s.create("u1", "task", { text: "hi" });
    expect(s.syncState().lastSyncedAt).not.toBeNull();
  });

  it("unsubscribing stops the reports, so a closed screen holds nothing", () => {
    const s = store();
    let hits = 0;
    const off = s.subscribe(() => { hits++; });
    off();
    const before = hits;
    s.goOffline();
    expect(hits).toBe(before);
  });
});
