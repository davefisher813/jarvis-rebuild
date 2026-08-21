import { describe, it, expect } from "vitest";
import { rightNow, rightNowLine, nowHHMM, endOf, FIFTEEN } from "./rightNow";
import type { TaskItem } from "./TasksService";

const task = (id: string, over: Partial<TaskItem["data"]> = {}): TaskItem =>
  ({ id, data: { text: id, category: "", done: false, ...over } }) as TaskItem;

describe("What Now / Just Fifteen", () => {
  const est = (t: TaskItem) => (t.id === "small" ? 10 : 90);

  it("offers the SMALLEST real thing, because the goal is motion", () => {
    expect(rightNow([task("big"), task("small")], est)!.task.id).toBe("small");
  });

  it("is fifteen minutes, and it ends", () => {
    const r = rightNow([task("a")], est, new Date(2026, 7, 21, 14, 5))!;
    expect(r.minutes).toBe(FIFTEEN);
    expect(endOf(r.startHHMM, r.minutes)).toBe("14:20");
  });

  it("starts NOW, not on the next quarter hour", () => {
    expect(rightNow([task("a")], est, new Date(2026, 7, 21, 14, 7))!.startHHMM).toBe("14:07");
  });

  it("renders nothing when it cannot act", () => {
    expect(rightNow([], est)).toBeNull();
    expect(rightNow([task("d", { done: true })], est)).toBeNull();
    expect(rightNow([task("r", { reminder: { time: "08:00" } })], est)).toBeNull();
  });

  it("promises a start, never a finish", () => {
    const line = rightNowLine(rightNow([task("a")], est)!);
    expect(line).toBe("15 Minutes on it, starting now");
    expect(line).not.toMatch(/finish|complete|done/i);
  });

  it("never mentions how many others are waiting", () => {
    const line = rightNowLine(rightNow([task("a"), task("b"), task("c")], est)!);
    expect(line).not.toMatch(/\b(2|3|other|more|remaining)\b/i);
  });

  it("rolls the clock correctly near midnight", () => {
    expect(endOf("23:55", 15)).toBe("00:10");
  });

  it("reads the wall clock in 24h, zero padded", () => {
    expect(nowHHMM(new Date(2026, 7, 21, 9, 4))).toBe("09:04");
  });
});
