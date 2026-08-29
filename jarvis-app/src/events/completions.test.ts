import { describe, it, expect } from "vitest";
import { unifyCompletions } from "./completions";
import { EVENT_SCHEMA_VERSION, type JarvisEvent } from "./types";
import type { CompletionSample } from "../shared/timeSense";

const H = 3600_000;
const BASE = Date.parse("2026-08-20T12:00:00");

function ev(ts: number, over: Partial<JarvisEvent> = {}): JarvisEvent {
  return {
    id: "e" + ts,
    type: "task.completed",
    ts,
    v: EVENT_SCHEMA_VERSION,
    entityType: "task",
    entityId: "t" + ts,
    props: { category: "work" },
    ...over,
  };
}

function sample(t: number, over: Partial<CompletionSample> = {}): CompletionSample {
  const d = new Date(t);
  return { t, h: d.getHours(), dow: d.getDay(), cat: "work", ...over };
}

describe("unifyCompletions — one reader for what got done", () => {
  it("with no log events yet, legacy samples pass through untouched", () => {
    const legacy = [sample(BASE - 5 * H), sample(BASE - 2 * H)];
    expect(unifyCompletions([], legacy)).toEqual(legacy);
    // Non-completion events alone don't flip the source either.
    const pushedOnly: JarvisEvent[] = [ev(BASE, { type: "task.pushed" })];
    expect(unifyCompletions(pushedOnly, legacy)).toEqual(legacy);
  });

  it("maps events to the sample shape the derivations already read", () => {
    const ts = Date.parse("2026-08-26T09:30:00"); // a Wednesday morning
    const out = unifyCompletions([ev(ts)], []);
    expect(out).toEqual([
      { t: ts, h: new Date(ts).getHours(), dow: new Date(ts).getDay(), cat: "work", id: "t" + ts },
    ]);
  });

  it("missing category or entityId degrade gracefully, never crash a count", () => {
    const bare = ev(BASE, { props: undefined, entityId: undefined });
    const out = unifyCompletions([bare], []);
    expect(out[0]?.cat).toBe("");
    expect(out[0]?.id).toBeUndefined();
  });

  it("unions pre-log history with log-era events at the cutover", () => {
    const firstEvent = BASE;
    const events = [ev(firstEvent), ev(firstEvent + 2 * H)];
    const legacy = [
      sample(firstEvent - 10 * H), // real pre-log history: kept
      sample(firstEvent - 3 * H), // real pre-log history: kept
      sample(firstEvent - 1000), // the first event's own Time Sense twin: dropped
      sample(firstEvent + 2 * H - 500), // a log-era twin: dropped
    ];
    const out = unifyCompletions(events, legacy);
    expect(out).toHaveLength(4); // 2 legacy + 2 events, no completion counted twice
    expect(out.map((s) => s.t)).toEqual([
      firstEvent - 10 * H,
      firstEvent - 3 * H,
      firstEvent,
      firstEvent + 2 * H,
    ]);
  });

  it("ignores every non-completion event type", () => {
    const events: JarvisEvent[] = [
      ev(BASE, { type: "task.pushed" }),
      ev(BASE + H),
      ev(BASE + 2 * H, { type: "reminder.ticked" }),
      ev(BASE + 3 * H, { type: "entity.updated" }),
    ];
    const out = unifyCompletions(events, []);
    expect(out).toHaveLength(1);
    expect(out[0]?.t).toBe(BASE + H);
  });
});
