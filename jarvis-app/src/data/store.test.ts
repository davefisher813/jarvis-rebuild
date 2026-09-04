import { describe, it, expect } from "vitest";
import type { QueuedOp } from "@core";
import { queuePersistence } from "./store";

// S3-Q14 (2026-09-04): "Nothing is held when the signal drops." This is the
// app-side half of the persistence seam @core's Store takes an optional
// StorePersistence for -- load/save round-trip, keyed per user, and never
// crashing on a corrupt or missing value, same as every other localStorage
// module in this app.

function fakeStorage() {
  const s: Record<string, string> = {};
  return { getItem: (k: string) => s[k] ?? null, setItem: (k: string, v: string) => { s[k] = v; } };
}

describe("queuePersistence", () => {
  it("round-trips a queue through load/save", () => {
    const storage = fakeStorage();
    const p = queuePersistence("u1", storage);
    const queue: QueuedOp[] = [
      { op: "create", id: "c1", ownerId: "u1", entityType: "note", data: { title: "x" }, queuedAt: 100 },
      { op: "update", id: "t1", ownerId: "u1", patch: { done: true } },
      { op: "delete", id: "t2", ownerId: "u1" },
    ];
    p.save(queue);
    expect(p.load()).toEqual(queue);
  });

  it("starts empty, and stays empty for missing or corrupt storage", () => {
    const storage = fakeStorage();
    expect(queuePersistence("u1", storage).load()).toEqual([]);
    const broken = { getItem: () => "{not json", setItem: () => {} };
    expect(queuePersistence("u1", broken).load()).toEqual([]);
    const notArray = { getItem: () => '{"oops":true}', setItem: () => {} };
    expect(queuePersistence("u1", notArray).load()).toEqual([]);
  });

  it("keys by user, so two users on one device never share a queue", () => {
    const storage = fakeStorage();
    const opA: QueuedOp = { op: "delete", id: "x", ownerId: "A" };
    queuePersistence("A", storage).save([opA]);
    expect(queuePersistence("B", storage).load()).toEqual([]);
    expect(queuePersistence("A", storage).load()).toEqual([opA]);
  });
});
