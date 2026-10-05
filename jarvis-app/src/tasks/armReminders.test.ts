import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskItem } from "./TasksService";
import type { Category } from "../categories/types";
import type { ProfileData } from "../profile/types";

// ONE WAY TO ARM TASK REMINDERS (2026-10-04). AppShell, Today and the
// Reminder Settings save all arm through armTaskReminders; the notifications
// module is mocked so the native-only call can be read.
const ensure = vi.fn();
vi.mock("../shared/notifications", () => ({
  ensureTaskReminders: (...a: unknown[]) => ensure(...a),
}));

import { armTaskReminders, taskReminderArming } from "./armReminders";

const task = (id: string, category: string | undefined, over: Partial<TaskItem["data"]> = {}): TaskItem =>
  ({ id, data: { text: "Task " + id, done: false, category, reminder: { time: "09:00" }, ...over } as TaskItem["data"] });
const cat = (id: string, name: string): Category => ({ id, data: { name, color: "green" } as Category["data"] });
const notify = (over: Partial<NonNullable<ProfileData["notify"]>> = {}): NonNullable<ProfileData["notify"]> =>
  ({ overdue: true, events: true, goals: true, ...over });

const CATS = [cat("health", "Health"), cat("work", "Work")];

beforeEach(() => { ensure.mockReset(); ensure.mockResolvedValue(undefined); });

describe("taskReminderArming", () => {
  it("marks only a health reminder sensitive, and only with Hide Sensitive Details on", () => {
    const items = [task("a", "health"), task("b", "work"), task("c", undefined), task("d", "health", { reminder: undefined })];
    const on = taskReminderArming(items, CATS, notify({ privateAlerts: true }));
    expect(on.inputs.map((i) => [i.id, i.sensitive])).toEqual([["a", true], ["b", false], ["c", false]]);
    const off = taskReminderArming(items, CATS, notify({ privateAlerts: false }));
    expect(off.inputs.every((i) => !i.sensitive)).toBe(true);
    expect(taskReminderArming(items, CATS, undefined).inputs.every((i) => !i.sensitive)).toBe(true);
  });

  it("carries the quiet window only while Quiet Hours is on, with the sheet's default for an unset end", () => {
    const items = [task("a", "health")];
    expect(taskReminderArming(items, CATS, notify({ quietHours: true, quietFrom: "22:30", quietTo: "06:45" })).opts).toEqual({ quietFrom: "22:30", quietTo: "06:45" });
    expect(taskReminderArming(items, CATS, notify({ quietHours: true })).opts).toEqual({ quietFrom: "21:00", quietTo: "08:00" });
    expect(taskReminderArming(items, CATS, notify({ quietHours: false, quietFrom: "22:30", quietTo: "06:45" })).opts).toEqual({});
    expect(taskReminderArming(items, CATS, undefined).opts).toEqual({});
  });
});

const sources = (notifyPrefs: ProfileData["notify"], items: TaskItem[] = [task("a", "health")]) => ({
  tasks: { listTasks: async () => items },
  profile: { get: async () => ({ notify: notifyPrefs }) as ProfileData },
  categories: { list: async () => CATS },
});

describe("armTaskReminders", () => {
  it("hands the scheduler the settings it was saved with, fresh from the profile", async () => {
    await armTaskReminders(sources(notify({ privateAlerts: true, quietHours: true, quietFrom: "22:00", quietTo: "07:00" })), "2026-10-04");
    expect(ensure).toHaveBeenCalledTimes(1);
    const [inputs, today, , opts] = ensure.mock.calls[0]!;
    expect(today).toBe("2026-10-04");
    expect(inputs).toEqual([expect.objectContaining({ id: "a", sensitive: true })]);
    expect(opts).toEqual({ quietFrom: "22:00", quietTo: "07:00" });
  });

  it("when two arms overlap, the one that began last is the only one that schedules", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => { releaseFirst = r; });
    const slow = { ...sources(notify()), tasks: { listTasks: async () => { await gate; return [task("old", "work")]; } } };
    const first = armTaskReminders(slow, "2026-10-04");
    await armTaskReminders(sources(notify(), [task("new", "work")]), "2026-10-04");
    releaseFirst();
    await first;
    expect(ensure).toHaveBeenCalledTimes(1);
    expect((ensure.mock.calls[0]![0] as { id: string }[]).map((i) => i.id)).toEqual(["new"]);
  });

  it("a read that throws schedules nothing and does not throw", async () => {
    const broken = { ...sources(notify()), profile: { get: async () => { throw new Error("offline"); } } };
    await expect(armTaskReminders(broken, "2026-10-04")).resolves.toBeUndefined();
    expect(ensure).not.toHaveBeenCalled();
  });
});
