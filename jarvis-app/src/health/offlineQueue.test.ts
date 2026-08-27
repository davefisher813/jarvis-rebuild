import { describe, it, expect } from "vitest";
import { queueHealthLog, readPending, writePending, flushPending, type Storage2 } from "./offlineQueue";

function mem(): Storage2 {
  const m = new Map<string, string>();
  return { read: (k) => m.get(k) ?? null, write: (k, v) => { m.set(k, v); }, remove: (k) => { m.delete(k); } };
}

describe("a tap is never lost for want of signal", () => {
  it("queues synchronously with no network involved", () => {
    const s = mem();
    queueHealthLog({ entityType: "health_lights_out", data: { category: "sleep", at: 1 } }, s);
    expect(readPending(s)).toHaveLength(1);
    expect(readPending(s)[0]!.data).toEqual({ category: "sleep", at: 1 });
  });

  it("corrupt storage reads as an empty queue rather than throwing mid-tap", () => {
    const s = mem();
    s.write("jarvis.health.pending.v1", "{not json");
    expect(readPending(s)).toEqual([]);
  });

  it("keeps what fails, in order, and drops what lands", async () => {
    const s = mem();
    queueHealthLog({ entityType: "health_took_it", data: { category: "medication", at: 1 } }, s);
    queueHealthLog({ entityType: "health_took_it", data: { category: "medication", at: 2 } }, s);

    let saved = await flushPending(async () => { throw new Error("offline"); }, s);
    expect(saved).toBe(0);
    expect(readPending(s)).toHaveLength(2);

    saved = await flushPending(async (e) => (e.data.at === 1 ? "id1" : null), s);
    expect(saved).toBe(1);
    expect(readPending(s).map((e) => e.data.at)).toEqual([2]);

    saved = await flushPending(async () => "id2", s);
    expect(saved).toBe(1);
    expect(readPending(s)).toHaveLength(0);
  });

  it("flushing an empty queue is a no-op", async () => {
    const s = mem();
    expect(await flushPending(async () => "x", s)).toBe(0);
  });

  it("writePending round-trips directly", () => {
    const s = mem();
    writePending([{ entityType: "x", data: {}, queuedAt: 5 }], s);
    expect(readPending(s)).toEqual([{ entityType: "x", data: {}, queuedAt: 5 }]);
  });
});
