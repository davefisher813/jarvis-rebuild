import { describe, it, expect } from "vitest";
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
