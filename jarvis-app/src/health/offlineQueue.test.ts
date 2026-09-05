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

// HMN-F-07 (2026-09-05): "Health offline queue double-writes when two taps
// land inside one network round trip." The audit's repro: a 50ms save, a
// second tap at 10ms, and the server held rows 1, 1, 2.
describe("HMN-F-07: two flushes inside one round trip save every entry exactly once", () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("a second tap a beat after the first lands once each, in order", async () => {
    const s = mem();
    const server: number[] = [];
    const save = async (e: { data: Record<string, unknown> }) => { await wait(20); server.push(e.data.at as number); return "id" + e.data.at; };
    queueHealthLog({ entityType: "health_point_at_it", data: { category: "injury", at: 1 } }, s);
    const first = flushPending(save, s);
    await wait(5);
    queueHealthLog({ entityType: "health_point_at_it", data: { category: "injury", at: 2 } }, s);
    const second = flushPending(save, s);
    expect(await first).toBe(1);
    expect(await second).toBe(1);
    expect(server).toEqual([1, 2]);
    expect(readPending(s)).toHaveLength(0);
  });

  it("a tap queued while a flush is in flight is not dropped by that flush's write-back", async () => {
    const s = mem();
    queueHealthLog({ entityType: "health_took_it", data: { category: "medication", at: 1 } }, s);
    const save = async () => { await wait(20); return "id"; };
    const first = flushPending(save, s);
    await wait(5);
    queueHealthLog({ entityType: "health_took_it", data: { category: "medication", at: 2 } }, s);
    await first;
    // Entry 2 arrived mid-flight and must still be queued for the next pass.
    expect(readPending(s).map((e) => e.data.at)).toEqual([2]);
  });

  it("a flush that fails releases the line for the next one", async () => {
    const s = mem();
    queueHealthLog({ entityType: "health_took_it", data: { category: "medication", at: 1 } }, s);
    const failing = flushPending(async () => { throw new Error("offline"); }, s);
    const landing = flushPending(async () => "id1", s);
    expect(await failing).toBe(0);
    expect(await landing).toBe(1);
    expect(readPending(s)).toHaveLength(0);
  });
});
