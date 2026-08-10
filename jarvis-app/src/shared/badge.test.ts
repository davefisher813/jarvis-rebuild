import { describe, it, expect } from "vitest";
import { badgeCount } from "./badge";
import type { TaskItem } from "../tasks/TasksService";

const t = (id: string, due: string | undefined, done = false): TaskItem =>
  ({ id, data: { text: id, done, ...(due ? { due } : {}) } }) as TaskItem;

describe("badgeCount", () => {
  it("counts open tasks due today or before, and nothing else", () => {
    const tasks = [
      t("due-today", "2026-08-09"),
      t("overdue", "2026-08-01"),
      t("future", "2026-08-15"),
      t("no-due", undefined),
      t("done", "2026-08-09", true),
    ];
    expect(badgeCount(tasks, "2026-08-09")).toBe(2);
  });

  it("zero when the day is clear, so the badge actually clears", () => {
    expect(badgeCount([t("future", "2026-09-01")], "2026-08-09")).toBe(0);
  });
});
