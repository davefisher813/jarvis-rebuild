// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { applyRealtimeChange } from "./realtimeSync";
import { readPreload, writePreload, clearPreload } from "./preloadCache";
import { wireRealtime } from "./realtimeSync";

// UP-PLAT-06 (2026-09-06), option B. Two devices had no push path at all: a
// grep for postgres_changes returned nothing, and convergence relied on the
// three-second list cache plus a surface happening to re-list. The socket
// itself is not testable off a real project; the half that decides what a
// change means to the cache is, and it is the half that can lose a write.

const OWNER = "u1";
const row = (over: Record<string, unknown> = {}) => ({
  id: "n1", owner_id: OWNER, entity_type: "note", data: { title: "From the laptop" },
  updated_at: "2026-09-06T10:00:00.000Z", ...over,
});

beforeEach(() => clearPreload());

describe("one change against the preload cache", () => {
  it("an insert lands in the cached list and names the type to repaint", () => {
    writePreload(OWNER, "note", []);
    expect(applyRealtimeChange(OWNER, { eventType: "INSERT", new: row() })).toBe("note");
    expect(readPreload(OWNER, "note")).toHaveLength(1);
  });

  it("an update replaces the row it matches", () => {
    writePreload(OWNER, "note", [{ id: "n1", ownerId: OWNER, entityType: "note", data: { title: "Old" }, serverTime: 1 }]);
    expect(applyRealtimeChange(OWNER, { eventType: "UPDATE", new: row() })).toBe("note");
    expect(readPreload(OWNER, "note")![0]!.data).toEqual({ title: "From the laptop" });
  });

  // The rule that keeps this from undoing the user's own work: the cached row
  // may be this device's optimistic write (CachedAdapter writes through with a
  // fresh serverTime), and an event that crossed it in flight is older.
  it("an event older than what the cache holds is dropped, never applied", () => {
    // Stamped a minute after the event's own updated_at, which is what a
    // local write-through looks like when the event was already in flight.
    const mine = { id: "n1", ownerId: OWNER, entityType: "note", data: { title: "Mine, just now" }, serverTime: new Date("2026-09-06T10:01:00.000Z").getTime() };
    writePreload(OWNER, "note", [mine]);
    expect(applyRealtimeChange(OWNER, { eventType: "UPDATE", new: row() })).toBeNull();
    expect(readPreload(OWNER, "note")![0]!.data).toEqual({ title: "Mine, just now" });
  });

  it("a delete drops the row, using the type when the row carries one", () => {
    writePreload(OWNER, "note", [{ id: "n1", ownerId: OWNER, entityType: "note", data: {}, serverTime: 1 }]);
    expect(applyRealtimeChange(OWNER, { eventType: "DELETE", old: row() })).toBe("note");
    expect(readPreload(OWNER, "note")).toEqual([]);
  });

  // Before migration 0034 a delete carries the primary key alone, so the type
  // has to be found by walking the cached types, exactly as CachedAdapter's
  // own delete does.
  it("a delete carrying only the key still finds its row", () => {
    writePreload(OWNER, "note", [{ id: "n1", ownerId: OWNER, entityType: "note", data: {}, serverTime: 1 }]);
    expect(applyRealtimeChange(OWNER, { eventType: "DELETE", old: { id: "n1" } })).toBe("note");
    expect(readPreload(OWNER, "note")).toEqual([]);
  });

  it("a type with nothing cached is left alone: the surface's own list is the truth", () => {
    expect(applyRealtimeChange(OWNER, { eventType: "INSERT", new: row() })).toBeNull();
    expect(readPreload(OWNER, "note")).toBeNull();
  });

  it("a malformed payload changes nothing", () => {
    writePreload(OWNER, "note", []);
    expect(applyRealtimeChange(OWNER, { eventType: "INSERT", new: { id: 7 } })).toBeNull();
    expect(applyRealtimeChange(OWNER, { eventType: "DELETE", old: {} })).toBeNull();
    expect(readPreload(OWNER, "note")).toEqual([]);
  });

  it("no client (the demo and local builds) is a clean no-op, unsubscribe included", () => {
    expect(() => wireRealtime(null, OWNER)()).not.toThrow();
  });
});
