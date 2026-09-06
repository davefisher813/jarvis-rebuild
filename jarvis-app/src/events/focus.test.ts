// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { bus } from "./index";
import { focusStarted, focusFinished, armFocusCompletion } from "./focus";
import { ServerSink, type QueueStorage } from "./serverSink";
import type { JarvisEvent } from "./types";

// UP-MIND-05. focus.started and focus.completed have been in the schema since
// it was written with no emitter at all, so the Brain has never heard about
// the one thing this app exists to help with: beginning.

const seen: JarvisEvent[] = [];
beforeEach(() => {
  seen.length = 0;
  localStorage.clear();
});

const listen = () => bus.subscribe((e) => { seen.push(e); });

describe("focus blocks reach the log", () => {
  it("emits started with its length and the task it is for", () => {
    const off = listen();
    focusStarted("t1", 15, "fifteen");
    off();
    const e = seen.find((x) => x.type === "focus.started")!;
    expect(e.entityId).toBe("t1");
    expect(e.props).toEqual({ kind: "fifteen", n: 15 });
  });

  it("emits completed when the block's task is finished, with the real minutes", () => {
    const start = Date.parse("2026-09-05T09:00:00Z");
    focusStarted("t1", 15, "fifteen", start);
    const off = listen();
    focusFinished("t1", start + 12 * 60000);
    off();
    const e = seen.find((x) => x.type === "focus.completed")!;
    expect(e.props).toEqual({ kind: "fifteen", n: 12 });
  });

  // Most completions happen outside a block. That is the normal case, and a
  // row claiming otherwise would be a false fact about the user's day.
  it("says nothing when a task with no block is completed", () => {
    const off = listen();
    focusFinished("nobody");
    off();
    expect(seen.filter((e) => e.type === "focus.completed")).toEqual([]);
  });

  it("does not count a block abandoned hours ago", () => {
    const start = Date.parse("2026-09-05T09:00:00Z");
    focusStarted("t1", 15, "fifteen", start);
    const off = listen();
    focusFinished("t1", start + 9 * 3600e3);
    off();
    expect(seen.filter((e) => e.type === "focus.completed")).toEqual([]);
  });

  it("finishes only once", () => {
    const start = Date.now();
    focusStarted("t1", 15, "fifteen", start);
    const off = listen();
    focusFinished("t1", start + 60000);
    focusFinished("t1", start + 120000);
    off();
    expect(seen.filter((e) => e.type === "focus.completed")).toHaveLength(1);
  });

  // The listener lives on the bus rather than in a screen: a subscription
  // inside a component only hears the completions that happen while it is
  // mounted, and the one it missed would be the one that mattered.
  it("hears a completion through the bus once armed", () => {
    const start = Date.now();
    focusStarted("t1", 25, "ritual", start);
    const disarm = armFocusCompletion();
    const off = listen();
    bus.emit({ type: "task.completed", entityType: "task", entityId: "t1" });
    off();
    disarm();
    expect(seen.some((e) => e.type === "focus.completed")).toBe(true);
  });

  it("stays out of private mode's way", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("private"); });
    const off = listen();
    expect(() => focusStarted("t1", 15, "fifteen")).not.toThrow();
    off();
    spy.mockRestore();
    expect(seen.some((e) => e.type === "focus.started")).toBe(true);
  });
});

// The whole point of the item: these types are durable, so a phone that dies
// does not take the Brain's intake with it. Asserted through the sink itself
// rather than by exporting its whitelist, because what matters is that the
// row is queued, not that a set contains a string.
describe("the new intake is persisted", () => {
  function memStorage(): QueueStorage & { rows: () => unknown[] } {
    let v: string | null = null;
    return { read: () => v, write: (x) => { v = x; }, rows: () => (v ? JSON.parse(v) as unknown[] : []) };
  }

  it("queues every new type for the server", () => {
    const store = memStorage();
    const sink = new ServerSink(store, () => null);
    const types = ["decision.recorded", "chat.answered", "health.logged", "person.reached", "focus.started", "focus.completed"] as const;
    for (const t of types) sink.capture({ id: "e" + t, ts: Date.now(), v: 1, type: t, props: { kind: "new" } });
    expect(store.rows()).toHaveLength(types.length);
  });

  it("still drops the free-form escape hatch", () => {
    const store = memStorage();
    const sink = new ServerSink(store, () => null);
    sink.capture({ id: "e1", ts: Date.now(), v: 1, type: "action", props: { name: "health.health_lights_out" } });
    expect(store.rows()).toHaveLength(0);
  });
});
