import { describe, it, expect } from "vitest";
import {
  proposeFirstMove, ritualIsReady, whyNotReady, ritualLine,
  nextStart, endsAt, minutesUntil, DEFAULT_MINUTES, LENGTHS, type Ritual,
} from "./startRitual";

// THE START RITUAL (C1, approved 2026-08-20). No test file existed for this
// module before S6-Q36 touched it (the first move now persists onto the
// task's own if-then plan, instead of being thrown away after one toast) --
// these pin the pure container math the sheet and Today both rely on.

const base: Ritual = { taskId: "t1", text: "Send the invoice", firstMove: "Open the template", startHHMM: "15:00", minutes: 25 };

describe("proposeFirstMove", () => {
  it("borrows the task's own words, capitalized as a move rather than a project", () => {
    expect(proposeFirstMove("open the invoice template")).toBe("Open the invoice template");
  });

  it("never exceeds five words, same limit the if-then research names", () => {
    const move = proposeFirstMove("send the client the signed invoice today before lunch");
    expect(move.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
  });
});

describe("ritualIsReady / whyNotReady", () => {
  it("is ready once a task, a start time and a usable first move are all set", () => {
    expect(ritualIsReady(base)).toBe(true);
    expect(whyNotReady(base)).toBeNull();
  });

  it("names a missing start time before anything else", () => {
    expect(whyNotReady({ ...base, startHHMM: "" })).toBe("Pick a start time");
    expect(ritualIsReady({ ...base, startHHMM: "" })).toBe(false);
  });

  it("names an unusable first move once a start time exists", () => {
    expect(whyNotReady({ ...base, firstMove: "" })).toBe("Name the first move · Five words or fewer");
    expect(ritualIsReady({ ...base, firstMove: "" })).toBe(false);
  });

  it("with no taskId at all, is simply not ready", () => {
    expect(ritualIsReady({ ...base, taskId: "" })).toBe(false);
  });
});

describe("ritualLine", () => {
  it("states the container and the move, and nothing about finishing", () => {
    expect(ritualLine(base)).toBe("25 Minutes · Open the template");
    expect(ritualLine(base)).not.toMatch(/finish/i);
  });
});

describe("nextStart", () => {
  it("rounds up to the next quarter hour, never right now", () => {
    expect(nextStart("14:07")).toBe("14:15");
    expect(nextStart("14:15")).toBe("14:30"); // exactly on a quarter still moves forward
    expect(nextStart("14:59")).toBe("15:00");
  });
});

describe("endsAt", () => {
  it("adds the container length to the start", () => {
    expect(endsAt(base)).toBe("15:25");
    expect(endsAt({ startHHMM: "23:50", minutes: 25 })).toBe("00:15");
  });
});

describe("minutesUntil", () => {
  it("counts up to a future start and goes negative once it has begun", () => {
    expect(minutesUntil("15:00", "14:45")).toBe(15);
    expect(minutesUntil("15:00", "15:10")).toBe(-10);
  });
});

describe("constants", () => {
  it("offers 25 minutes as the default, among the three lengths", () => {
    expect(LENGTHS).toContain(DEFAULT_MINUTES);
  });
});
