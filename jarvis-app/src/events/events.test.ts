import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./bus";
import { LocalEventLog, type EventStorage } from "./log";
import { EVENT_SCHEMA_VERSION, type JarvisEvent } from "./types";

function memStorage(): EventStorage {
  let v: string | null = null;
  return {
    read: () => v,
    write: (x) => {
      v = x;
    },
  };
}

describe("EventBus", () => {
  it("stamps id, ts, and schema version on emit", () => {
    const bus = new EventBus();
    const e = bus.emit({ type: "app.opened" });
    expect(e.id).toBeTruthy();
    expect(typeof e.ts).toBe("number");
    expect(e.v).toBe(EVENT_SCHEMA_VERSION);
    expect(e.type).toBe("app.opened");
  });

  it("delivers events to subscribers", () => {
    const bus = new EventBus();
    const got: JarvisEvent[] = [];
    bus.subscribe((e) => got.push(e));
    bus.emit({ type: "task.completed", entityType: "task", entityId: "t1" });
    expect(got.length).toBe(1);
    expect(got[0]!.type).toBe("task.completed");
    expect(got[0]!.entityId).toBe("t1");
  });

  it("stops delivery after unsubscribe", () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.subscribe(() => count++);
    bus.emit({ type: "app.opened" });
    off();
    bus.emit({ type: "app.opened" });
    expect(count).toBe(1);
  });

  it("one throwing listener does not block the others", () => {
    const bus = new EventBus();
    let reached = false;
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe(() => {
      reached = true;
    });
    bus.emit({ type: "app.opened" });
    expect(reached).toBe(true);
  });
});

describe("LocalEventLog", () => {
  it("appends and reads back, surviving a fresh instance on the same storage", () => {
    const storage = memStorage();
    const log = new LocalEventLog(storage);
    log.append({ id: "1", type: "app.opened", ts: 1, v: 1 });
    log.append({ id: "2", type: "auth.signed_in", ts: 2, v: 1 });
    // PLUMB-F-14 (2026-09-05): the write is debounced now, so what makes a
    // fresh launch see these is the flush the app does on its way to the
    // background (events/index.ts wires pagehide and visibilitychange). The
    // assertion this test was written for is unchanged.
    log.flush();
    // a fresh log reading the same storage = a fresh app launch
    const reloaded = new LocalEventLog(storage);
    expect(reloaded.all().map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("returns empty on no data and on corrupt data", () => {
    const empty = new LocalEventLog(memStorage());
    expect(empty.all()).toEqual([]);

    const bad = memStorage();
    bad.write("not json");
    expect(new LocalEventLog(bad).all()).toEqual([]);
  });

  it("caps growth by dropping oldest beyond the cap", () => {
    const log = new LocalEventLog(memStorage(), 3);
    for (let i = 1; i <= 5; i++) {
      log.append({ id: String(i), type: "app.opened", ts: i, v: 1 });
    }
    expect(log.all().map((e) => e.id)).toEqual(["3", "4", "5"]);
  });

  it("captures from the bus when subscribed", () => {
    const bus = new EventBus();
    const log = new LocalEventLog(memStorage());
    bus.subscribe((e) => log.append(e));
    bus.emit({ type: "screen.viewed", props: { screen: "today" } });
    const all = log.all();
    expect(all.length).toBe(1);
    expect(all[0]!.type).toBe("screen.viewed");
    expect(all[0]!.props?.screen).toBe("today");
  });
});

// PLUMB-F-14 (2026-09-05): "every emit re-parses and re-serializes the whole
// log on the main thread." These are about COST, which the suite had no test
// for: correctness above passed the whole time the app was spending 12 ms of
// a phone's main thread on every save.
describe("LocalEventLog cost", () => {
  function countingStorage() {
    let v: string | null = null;
    const counts = { reads: 0, writes: 0 };
    const storage: EventStorage = {
      read: () => { counts.reads++; return v; },
      write: (x) => { counts.writes++; v = x; },
    };
    return { storage, counts, raw: () => v };
  }

  it("reads storage once, however many times it is appended to or read", () => {
    const s = countingStorage();
    const log = new LocalEventLog(s.storage);
    for (let i = 0; i < 50; i++) log.append({ id: String(i), type: "task.completed", ts: i, v: 1 });
    log.all();
    log.all();
    expect(s.counts.reads).toBe(1);
  });

  it("does not write on every append: a burst costs one write, not one each", () => {
    vi.useFakeTimers();
    try {
      const s = countingStorage();
      const log = new LocalEventLog(s.storage, 10000, 2000);
      for (let i = 0; i < 20; i++) log.append({ id: String(i), type: "task.completed", ts: i, v: 1 });
      expect(s.counts.writes).toBe(0);
      // The events are readable the whole time; only the write is deferred.
      expect(log.all().length).toBe(20);
      vi.advanceTimersByTime(2000);
      expect(s.counts.writes).toBe(1);
      expect(JSON.parse(String(s.raw())).length).toBe(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flush writes what is pending and then has nothing to write", () => {
    const s = countingStorage();
    const log = new LocalEventLog(s.storage);
    log.append({ id: "1", type: "task.completed", ts: 1, v: 1 });
    log.flush();
    log.flush();
    expect(s.counts.writes).toBe(1);
  });

  it("keeps entity.updated out of the local log, the way the server sink already does", () => {
    const log = new LocalEventLog(memStorage());
    log.append({ id: "1", type: "entity.updated", entityType: "task", entityId: "t1", ts: 1, v: 1 });
    log.append({ id: "2", type: "task.completed", entityType: "task", entityId: "t1", ts: 2, v: 1 });
    expect(log.all().map((e) => e.type)).toEqual(["task.completed"]);
  });

  it("hands out a copy, so a reader cannot edit the log", () => {
    const log = new LocalEventLog(memStorage());
    log.append({ id: "1", type: "app.opened", ts: 1, v: 1 });
    log.all().push({ id: "2", type: "app.opened", ts: 2, v: 1 });
    expect(log.all().length).toBe(1);
  });

  it("clear empties the in-memory copy too, not just storage", () => {
    const s = countingStorage();
    const log = new LocalEventLog(s.storage);
    log.append({ id: "1", type: "app.opened", ts: 1, v: 1 });
    log.clear();
    expect(log.all()).toEqual([]);
    log.flush();
    expect(s.raw()).toBe("[]");
  });
});
