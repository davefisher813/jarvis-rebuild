import { describe, it, expect } from "vitest";
import { ServerSink, rowFrom, localDayParts, type EventRow, type QueueStorage, type SinkClient } from "./serverSink";
import type { JarvisEvent } from "./types";

// The durable sink is the foundation of the Brain: if it drops events, leaks
// text, or double-sends, every derivation built on it inherits the lie. These
// tests pin the queue, the whitelist, the no-free-text rule, and flush retry.

function memStorage(): QueueStorage & { raw: () => string | null } {
  let v: string | null = null;
  return { read: () => v, write: (x) => { v = x; }, raw: () => v };
}

function fakeClient(behavior: { failTimes?: number } = {}) {
  const calls: EventRow[][] = [];
  let fails = behavior.failTimes ?? 0;
  const client: SinkClient = {
    from: (table: string) => ({
      upsert: (rows: EventRow[], opts: { onConflict: string; ignoreDuplicates: boolean }) => {
        expect(table).toBe("event_log");
        expect(opts).toEqual({ onConflict: "id", ignoreDuplicates: true });
        if (fails > 0) {
          fails--;
          return Promise.resolve({ error: new Error("offline") });
        }
        calls.push(rows);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { client, calls };
}

function ev(type: JarvisEvent["type"], extra: Partial<JarvisEvent> = {}): JarvisEvent {
  // 10:30 local on a fixed date, built from local components so the test is
  // timezone-independent.
  const ts = new Date(2026, 7, 3, 10, 30).getTime();
  return { id: "e1", ts, v: 1, type, ...extra };
}

describe("rowFrom", () => {
  it("maps typed props to columns and DROPS everything else (no-free-text rule)", () => {
    const row = rowFrom(
      ev("task.completed", {
        entityType: "task",
        entityId: "t1",
        props: { category: "cat-1", n: 2, flag: true, kind: "link", text: "SECRET TASK TEXT", note: "leak" },
      }),
    );
    expect(row.category).toBe("cat-1");
    expect(row.n).toBe(2);
    expect(row.flag).toBe(true);
    expect(row.entity_id).toBe("t1");
    expect(row.kind).toBe("link");
    // the leak check: no property of the row may carry the dropped prop values
    expect(JSON.stringify(row)).not.toContain("SECRET");
    expect(JSON.stringify(row)).not.toContain("leak");
    // kind is a closed vocabulary: arbitrary text in the kind prop is dropped
    const sneaky = rowFrom(ev("suggestion.dismissed", { props: { kind: "Bought a boat today lol" } }));
    expect(sneaky.kind).toBeNull();
  });

  it("stamps the LOCAL day/hour/dow of the moment it happened", () => {
    const ts = new Date(2026, 7, 3, 23, 45).getTime(); // Aug 3 2026, 23:45 local (a Monday)
    const row = rowFrom({ id: "x", ts, v: 1, type: "task.completed" });
    expect(row.day).toBe("2026-08-03");
    expect(row.h).toBe(23);
    expect(row.dow).toBe(1);
    expect(localDayParts(ts).day).toBe("2026-08-03");
  });

  it("lets an event that names its own day win the day column (plan.outcome)", () => {
    const ts = new Date(2026, 7, 4, 9, 0).getTime(); // resolver ran Aug 4
    const row = rowFrom({ id: "x", ts, v: 1, type: "plan.outcome", props: { n: 1, flag: true, day: "2026-08-03" } });
    // The receipt points at the plan's day, not the morning the resolver ran.
    expect(row.day).toBe("2026-08-03");
    // Shape-gated like kind: a malformed day is ignored, never stored.
    const junk = rowFrom({ id: "y", ts, v: 1, type: "plan.outcome", props: { flag: false, day: "last tuesday, roughly" } });
    expect(junk.day).toBe("2026-08-04");
    expect(JSON.stringify(junk)).not.toContain("tuesday");
  });
});

describe("ServerSink", () => {
  it("queues whitelisted events and ignores noise (entity.updated, screen.viewed)", () => {
    const storage = memStorage();
    const sink = new ServerSink(storage, () => null);
    sink.capture(ev("task.completed"));
    sink.capture(ev("entity.updated"));
    sink.capture(ev("screen.viewed"));
    sink.capture(ev("plan.picked"));
    expect(sink.queue().map((r) => r.type)).toEqual(["task.completed", "plan.picked"]);
  });

  // The deck's voice metric, promoted from a device-local "action" on
  // 2026-08-07. flag carries edited-first; nothing else about the send leaves
  // the device (no recipient, no subject, no text: rowFrom has no columns
  // for them and drops unknown props by construction).
  it("persists email.deck_sent with the edited flag and nothing else", () => {
    const storage = memStorage();
    const sink = new ServerSink(storage, () => null);
    sink.capture(ev("email.deck_sent", { props: { flag: true, subject: "LEAK" } }));
    const rows = sink.queue();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("email.deck_sent");
    expect(rows[0]!.flag).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain("LEAK");
  });

  it("holds the queue with no client (demo mode) and flushes once connected", async () => {
    const storage = memStorage();
    let c: SinkClient | null = null;
    const sink = new ServerSink(storage, () => c);
    sink.capture(ev("task.completed"));
    expect(await sink.flush()).toBe(0);
    expect(sink.queue()).toHaveLength(1);
    const { client, calls } = fakeClient();
    c = client;
    expect(await sink.flush()).toBe(1);
    expect(sink.queue()).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("keeps everything on a failed flush and retries clean later (offline)", async () => {
    const storage = memStorage();
    const { client, calls } = fakeClient({ failTimes: 1 });
    const sink = new ServerSink(storage, () => client);
    sink.capture(ev("task.completed"));
    sink.capture(ev("task.pushed"));
    // capture() already attempted a flush, which consumed the one failure;
    // wait a tick so that in-flight attempt fully settles.
    await Promise.resolve();
    expect(sink.queue()).toHaveLength(2);
    expect(await sink.flush()).toBe(2);
    expect(sink.queue()).toHaveLength(0);
    expect(calls.flat()).toHaveLength(2);
  });

  it("sends in batches of 100 and drains a big queue completely", async () => {
    const storage = memStorage();
    const { client, calls } = fakeClient();
    const sink = new ServerSink(storage, () => client);
    for (let i = 0; i < 250; i++) sink.enqueueRaw({ ...rowFrom(ev("task.completed")), id: "id-" + i });
    expect(await sink.flush()).toBe(250);
    expect(calls.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(sink.queue()).toHaveLength(0);
  });

  it("caps the offline queue by dropping oldest, never breaking", () => {
    const storage = memStorage();
    const sink = new ServerSink(storage, () => null, 5);
    for (let i = 0; i < 8; i++) sink.enqueueRaw({ ...rowFrom(ev("task.completed")), id: "id-" + i });
    const ids = sink.queue().map((r) => r.id);
    expect(ids).toEqual(["id-3", "id-4", "id-5", "id-6", "id-7"]);
  });
});
