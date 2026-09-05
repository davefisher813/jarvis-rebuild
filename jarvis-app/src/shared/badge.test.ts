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

// SHARED-F-12 (2026-09-05): the badge had no native path at all, so on the
// platform this rebuild ships to it was a no-op. The web branch stays for the
// PWA; native goes through the Capacitor plugin, and zero CLEARS rather than
// drawing a badge that says nothing needs doing.
import { vi, afterEach } from "vitest";
import { Capacitor } from "@capacitor/core";
import { setAppBadge } from "./badge";

describe("setAppBadge", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the web Badging API off native, and clears at zero", async () => {
    const nav = navigator as Navigator & { setAppBadge?: unknown; clearAppBadge?: unknown };
    const restore = () => { Reflect.deleteProperty(nav, "setAppBadge"); Reflect.deleteProperty(nav, "clearAppBadge"); };
    const set = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    nav.setAppBadge = set;
    nav.clearAppBadge = clear;
    try {
      await setAppBadge(3);
      expect(set).toHaveBeenCalledWith(3);
      await setAppBadge(0);
      expect(clear).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("never throws, whatever the platform answers", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    await expect(setAppBadge(2)).resolves.toBeUndefined();
    await expect(setAppBadge(0)).resolves.toBeUndefined();
  });
});
