// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { learnedDurations, readCommittedDurationsWindowed, type CommittedDuration } from "./learnedDurations";
import type { WindowClient } from "../brain/window";
import { emit, eventLog } from "../events";

// Same shape as brain/window.test.ts's fakeClient: a WindowClient that
// answers with fixed rows, for exercising the real-server path without a
// server.
function fakeWindowClient(rows: unknown[]): WindowClient {
  return {
    from: () => ({
      select: () => ({
        gte: () => ({
          in: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    }),
  };
}

const NOW = 1_700_000_000_000;
const DAY = 86400000;
const s = (category: string, minutes: number, daysAgo = 0): CommittedDuration => ({ category, minutes, ts: NOW - daysAgo * DAY });

describe("learnedDurations", () => {
  it("needs three samples before it says anything: silence beats a guess", () => {
    expect(learnedDurations([s("work", 60), s("work", 60)], NOW)).toEqual({});
  });

  it("takes the median so one runaway afternoon cannot skew a category", () => {
    expect(learnedDurations([s("work", 30), s("work", 45), s("work", 180)], NOW)).toEqual({ work: 45 });
  });

  it("snaps to the stepper's step and clamps to its range", () => {
    // median 50 -> 45; a category living at 10 minutes floors to 15.
    expect(learnedDurations([s("work", 50), s("work", 50), s("work", 50)], NOW)).toEqual({ work: 45 });
    expect(learnedDurations([s("q", 10), s("q", 10), s("q", 10)], NOW)).toEqual({ q: 15 });
  });

  it("forgets samples older than 30 days", () => {
    expect(learnedDurations([s("work", 60, 40), s("work", 60, 45), s("work", 60, 50)], NOW)).toEqual({});
  });

  it("learns each category on its own evidence", () => {
    const out = learnedDurations(
      [s("work", 60), s("work", 60), s("work", 60), s("gym", 90), s("gym", 90)],
      NOW,
    );
    expect(out).toEqual({ work: 60 }); // gym has only 2 samples: silence
  });
});

// S4-Q28 (2026-09-04): this used to read the device's own local log only,
// so a duration committed on one phone never taught a second phone
// anything. Now it reads through the window, which already carries
// plan.duration_committed rows in from the server, and falls back to the
// exact same local log when there is no client (demo mode).
describe("readCommittedDurationsWindowed", () => {
  beforeEach(() => { eventLog.clear(); });

  it("with no client at all, reads the local log back and ignores noise and junk (demo mode)", async () => {
    emit({ type: "plan.duration_committed", entityType: "task", entityId: "t1", props: { category: "work", n: 45 } });
    emit({ type: "plan.duration_committed", entityType: "task", entityId: "t2", props: { category: "", n: 45 } }); // no category: dropped
    emit({ type: "plan.picked", entityType: "task", entityId: "t3", props: { n: 1 } }); // noise
    const out = await readCommittedDurationsWindowed(null, Date.now());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ category: "work", minutes: 45 });
  });

  it("reads a duration committed on another device back through a real client", async () => {
    const client = fakeWindowClient([
      { type: "plan.duration_committed", day: "2026-08-20", h: 9, category: "work", n: 60, flag: null, kind: null },
    ]);
    const out = await readCommittedDurationsWindowed(client, Date.now());
    expect(out).toEqual([{ category: "work", minutes: 60, ts: new Date("2026-08-20T09:00:00").getTime() }]);
  });

  it("drops a server row missing its category or minutes, same as the local path does", async () => {
    const client = fakeWindowClient([
      { type: "plan.duration_committed", day: "2026-08-20", h: 9, category: null, n: 60, flag: null, kind: null },
      { type: "plan.picked", day: "2026-08-20", h: 9, category: "work", n: 1, flag: null, kind: null },
    ]);
    const out = await readCommittedDurationsWindowed(client, Date.now());
    expect(out).toEqual([]);
  });
});
