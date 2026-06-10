import { describe, it, expect } from "vitest";
import { weekDates, eventsThisWeek, openTasksByArea, accountBars, maxValue } from "./insights";
import type { EventItem } from "../schedule/types";
import type { TaskItem } from "../tasks/TasksService";
import type { Account } from "../money/types";

describe("insights", () => {
  it("weekDates is Monday-anchored, 7 days incl today", () => {
    const w = weekDates("2026-05-24"); // a Sunday
    expect(w.length).toBe(7);
    expect(w[0]).toBe("2026-05-18"); // Monday
    expect(w[6]).toBe("2026-05-24"); // Sunday
  });
  it("buckets events into the right weekday", () => {
    const ev: EventItem[] = [{ id: "1", data: { title: "A", date: "2026-05-24", start: "09:00", category: "" } }];
    const bars = eventsThisWeek(ev, "2026-05-24");
    expect(bars[6]!.value).toBe(1);
    expect(maxValue(bars)).toBe(1);
  });
  it("counts open tasks per area, drops empties, sorts desc", () => {
    const tasks: TaskItem[] = [
      { id: "1", data: { text: "a", category: "c1", done: false, due: null } },
      { id: "2", data: { text: "b", category: "c1", done: false, due: null } },
      { id: "3", data: { text: "c", category: "c2", done: true, due: null } },
    ];
    const bars = openTasksByArea(tasks, [{ id: "c1", name: "Work", slot: "blue" }, { id: "c2", name: "Home", slot: "green" }]);
    expect(bars.length).toBe(1);
    expect(bars[0]!.label).toBe("Work");
    expect(bars[0]!.value).toBe(2);
  });
  it("account bars use absolute value for size, signed for display", () => {
    const accts: Account[] = [{ id: "1", data: { name: "Card", balance: -300, kind: "credit" } }];
    const bars = accountBars(accts, () => "red", (n) => String(n));
    expect(bars[0]!.value).toBe(300);
    expect(bars[0]!.display).toBe("-300");
  });
});
