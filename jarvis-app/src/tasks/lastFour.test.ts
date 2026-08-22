import { describe, it, expect } from "vitest";
import {
  proposeFirstMove, ritualIsReady, whyNotReady, ritualLine, nextStart, endsAt,
  minutesUntil, DEFAULT_MINUTES, LENGTHS, type Ritual,
} from "./startRitual";

describe("C1 · the start ritual", () => {
  const r = (over: Partial<Ritual> = {}): Ritual => ({
    taskId: "t1", text: "Create Bridge Invoice", firstMove: "Open the invoice template",
    startHHMM: "13:00", minutes: DEFAULT_MINUTES, ...over,
  });

  it("proposes a first move from the task's own words", () => {
    expect(proposeFirstMove("Create Bridge Invoice")).toBe("Create Bridge Invoice");
  });

  it("a first move must be a MOVE, not a project", () => {
    expect(ritualIsReady(r())).toBe(true);
    expect(ritualIsReady(r({ firstMove: "work on the invoice for the Bridge event" }))).toBe(false);
    expect(ritualIsReady(r({ firstMove: "" }))).toBe(false);
  });

  it("needs a hard start: 'whenever you're ready' is the stuck state", () => {
    expect(ritualIsReady(r({ startHHMM: "" }))).toBe(false);
    expect(whyNotReady(r({ startHHMM: "" }))).toBe("Pick a start time");
  });

  it("says what is missing, in his terms", () => {
    expect(whyNotReady(r())).toBeNull();
    expect(whyNotReady(r({ firstMove: "a b c d e f" }))).toContain("Five words or fewer");
  });

  it("the line states the container and the move, and NOTHING about finishing", () => {
    const line = ritualLine(r());
    expect(line).toBe("25 Minutes · Open the invoice template");
    expect(line).not.toMatch(/finish|complete|done|until/i);
  });

  it("starts at the next quarter hour, never this second", () => {
    expect(nextStart("13:02")).toBe("13:15");
    expect(nextStart("13:15")).toBe("13:30");
    expect(nextStart("13:59")).toBe("14:00");
  });

  it("ends, because an open-ended session is another thing to manage", () => {
    expect(endsAt({ startHHMM: "13:00", minutes: 25 })).toBe("13:25");
    expect(endsAt({ startHHMM: "23:50", minutes: 25 })).toBe("00:15");
    expect(LENGTHS).toContain(DEFAULT_MINUTES);
  });

  it("counts down, and a started session reads as running rather than late", () => {
    expect(minutesUntil("13:00", "12:45")).toBe(15);
    expect(minutesUntil("13:00", "13:10")).toBe(-10);
  });
});
