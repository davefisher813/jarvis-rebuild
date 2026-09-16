import { describe, it, expect } from "vitest";
import {
  readFifteen, writeFifteen, clearFifteen, remainingMs, overdueMs,
  isStillLive, countdown, fifteenFace, extended, STALE_MS, type LiveFifteen, type Storage2,
} from "./liveFifteen";

const TODAY = "2026-09-16";
const T0 = new Date("2026-09-16T18:00:00").getTime();

const mem = (): Storage2 => {
  const m = new Map<string, string>();
  return {
    read: (k) => m.get(k) ?? null,
    write: (k, v) => { m.set(k, v); },
    remove: (k) => { m.delete(k); },
  };
};

const live = (over: Partial<LiveFifteen> = {}): LiveFifteen => ({
  taskId: "t1", text: "Call the bank", startedAt: T0, startHHMM: "18:00",
  date: TODAY, minutes: 15, rounds: 1, ...over,
});

describe("the live fifteen", () => {
  it("survives the app: it round-trips through storage and clears", () => {
    const store = mem();
    expect(readFifteen(store)).toBeNull();
    writeFifteen(live(), store);
    expect(readFifteen(store)?.taskId).toBe("t1");
    clearFifteen(store);
    expect(readFifteen(store)).toBeNull();
  });

  it("survives junk in storage rather than taking the page down with it", () => {
    const store = mem();
    store.write("jarvis.today.fifteen.v1", "{not json");
    expect(readFifteen(store)).toBeNull();
  });

  // THE CLOCK, NOT THE TICKS. A phone that slept through ten minutes comes
  // back to a countdown ten minutes further along, because the answer is
  // computed from wall time every time it is asked.
  it("reads the clock, and neither half ever goes negative", () => {
    expect(remainingMs(live(), T0 + 60_000)).toBe(14 * 60_000);
    expect(remainingMs(live(), T0 + 99 * 60_000)).toBe(0);
    expect(overdueMs(live(), T0 + 60_000)).toBe(0);
    expect(overdueMs(live(), T0 + 20 * 60_000)).toBe(5 * 60_000);
  });

  it("counts down in mm:ss, and a block with a sliver left never reads 0:00", () => {
    expect(countdown(14 * 60_000 + 32_000)).toBe("14:32");
    expect(countdown(60_000)).toBe("1:00");
    expect(countdown(1)).toBe("0:01");
    expect(countdown(0)).toBe("0:00");
  });

  it("says the clock while it runs and states the fact when it is up", () => {
    expect(fifteenFace(live(), T0 + 32_000).line).toBe("14:28 Left");
    expect(fifteenFace(live(), T0 + 32_000).over).toBe(false);
    const done = fifteenFace(live(), T0 + 15 * 60_000);
    expect(done.over).toBe(true);
    expect(done.line).toBe("15 Minutes up");
    expect(done.text).toBe("Call the bank");
  });

  // An unanswered question expires: the prompt is worth asking now, and
  // worth nothing tomorrow morning.
  it("stays live through the block and an hour after, then stops asking", () => {
    expect(isStillLive(live(), TODAY, T0 + 60_000)).toBe(true);
    expect(isStillLive(live(), TODAY, T0 + 15 * 60_000 + STALE_MS - 1)).toBe(true);
    expect(isStillLive(live(), TODAY, T0 + 15 * 60_000 + STALE_MS)).toBe(false);
    expect(isStillLive(live(), "2026-09-17", T0 + 60_000)).toBe(false);
  });

  it("gives another fifteen from now, not from where the last one ended", () => {
    // Answered six minutes after it ran out: the next block ends fifteen
    // minutes from this moment, so 21 minutes in plus 15.
    const late = extended(live(), 15, T0 + 21 * 60_000);
    expect(late.minutes).toBe(36);
    expect(late.rounds).toBe(2);
    expect(remainingMs(late, T0 + 21 * 60_000)).toBe(15 * 60_000);
    // Taken early, it is still fifteen from now and never shrinks the block.
    const early = extended(live(), 15, T0 + 10 * 60_000);
    expect(early.minutes).toBe(25);
    expect(remainingMs(early, T0 + 10 * 60_000)).toBe(15 * 60_000);
    // The block keeps its own start, so the calendar says one sitting.
    expect(late.startHHMM).toBe("18:00");
    expect(late.startedAt).toBe(T0);
  });
});
