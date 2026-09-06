import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_ROUTINE } from "../routine/types";

// SHARED-F-07 (2026-09-05): "The OS permission prompt fires on Today's first
// load, with no context." ensureCheckinNotifications both ASKED and
// scheduled, and TodayFlow calls it on mount with check-ins defaulting to on,
// so a fresh install met the iOS dialog before it had seen a screen. A denial
// there is permanent. Scheduling is check-only now, on all three blocks; the
// ask lives in onboarding's brief-time step and on the Notifications page.

const isNativePlatform = vi.fn(() => true);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

const checkPermissions = vi.fn();
const requestPermissions = vi.fn();
const schedule = vi.fn();
const cancel = vi.fn();
// UP-PLAT-01: registration is memoised for the life of the module (one
// registerActionTypes call per launch), so this one is never reset between
// tests: its recorded calls are the whole file's, which is exactly what the
// "registered once" assertion below needs.
const registerActionTypes = vi.fn().mockResolvedValue(undefined);
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: () => checkPermissions(),
    requestPermissions: () => requestPermissions(),
    schedule: (o: unknown) => schedule(o),
    cancel: (o: unknown) => cancel(o),
    registerActionTypes: (o: unknown) => registerActionTypes(o),
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
}));

import { ensureCheckinNotifications, ensureEventReminders, ensureTaskReminders, EVENT_ACTION_TYPE, TASK_ACTION_TYPE, ACTION_DONE, ACTION_TOMORROW } from "./notifications";

beforeEach(() => {
  checkPermissions.mockReset();
  requestPermissions.mockReset();
  schedule.mockReset();
  cancel.mockReset();
  requestPermissions.mockResolvedValue({ display: "granted" });
  schedule.mockResolvedValue(undefined);
  cancel.mockResolvedValue(undefined);
});

const NOW = new Date("2026-08-09T08:00:00").getTime();

describe("no scheduler ever raises the permission dialog", () => {
  it("check-ins ask nothing and schedule nothing before the user has said yes", async () => {
    checkPermissions.mockResolvedValue({ display: "prompt" });
    await ensureCheckinNotifications(DEFAULT_ROUTINE, "07:00");
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("check-ins schedule once the OS has granted it", async () => {
    checkPermissions.mockResolvedValue({ display: "granted" });
    await ensureCheckinNotifications(DEFAULT_ROUTINE, "07:00");
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("a denial stops the schedule without a second ask", async () => {
    checkPermissions.mockResolvedValue({ display: "denied" });
    await ensureCheckinNotifications(DEFAULT_ROUTINE, "07:00");
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("event and task reminders keep the same contract", async () => {
    checkPermissions.mockResolvedValue({ display: "prompt" });
    await ensureEventReminders([{ date: "2026-08-09", start: "23:00", title: "Late" }], NOW);
    await ensureTaskReminders([{ id: "r", text: "Meds", reminder: { time: "23:00" } }], "2026-08-09", NOW);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });
});

// UP-PLAT-01 (2026-09-06): "Act on a reminder from the lock screen." The
// banner had no buttons and carried no identity, so the only answer to a buzz
// was to unlock, find JARVIS, find the tab and find the row. These pin the
// two halves the OS needs: an action type registered before the first banner
// that names it, and the item's id in `extra` on every scheduled notification.
describe("the banner carries its buttons and its item (UP-PLAT-01)", () => {
  const NOW2 = new Date("2026-08-09T08:00:00").getTime();

  it("a task reminder is scheduled with the task action type and the task id", async () => {
    checkPermissions.mockResolvedValue({ display: "granted" });
    await ensureTaskReminders([{ id: "t7", text: "Meds", reminder: { time: "21:00" } }], "2026-08-09", NOW2);
    expect(schedule).toHaveBeenCalledTimes(1);
    const sent = schedule.mock.calls[0]![0] as { notifications: { actionTypeId?: string; extra?: { taskId?: string } }[] };
    expect(sent.notifications.length).toBeGreaterThan(0);
    for (const n of sent.notifications) {
      expect(n.actionTypeId).toBe(TASK_ACTION_TYPE);
      expect(n.extra?.taskId).toBe("t7");
    }
  });

  it("an event rung is scheduled with the event action type and the event id", async () => {
    checkPermissions.mockResolvedValue({ display: "granted" });
    await ensureEventReminders([{ id: "ev9", date: "2026-08-09", start: "23:00", title: "Late" }], NOW2);
    expect(schedule).toHaveBeenCalledTimes(1);
    const sent = schedule.mock.calls[0]![0] as { notifications: { actionTypeId?: string; extra?: { eventId?: string } }[] };
    expect(sent.notifications.length).toBeGreaterThan(0);
    for (const n of sent.notifications) {
      expect(n.actionTypeId).toBe(EVENT_ACTION_TYPE);
      expect(n.extra?.eventId).toBe("ev9");
    }
  });

  it("the action types are registered once, with Done and Tomorrow on the task type", () => {
    expect(registerActionTypes).toHaveBeenCalledTimes(1);
    const arg = registerActionTypes.mock.calls[0]![0] as { types: { id: string; actions: { id: string; title: string }[] }[] };
    const task = arg.types.find((t) => t.id === TASK_ACTION_TYPE);
    expect(task?.actions.map((a) => a.id)).toEqual([ACTION_DONE, ACTION_TOMORROW]);
    // Title Case on anything that acts (Apple HIG), and never ALL CAPS in a
    // source string.
    expect(task?.actions.map((a) => a.title)).toEqual(["Done", "Tomorrow"]);
    expect(arg.types.find((t) => t.id === EVENT_ACTION_TYPE)?.actions[0]?.title).toBe("Open");
  });

  it("a check-in carries no action type: there is nothing on it to tick", async () => {
    checkPermissions.mockResolvedValue({ display: "granted" });
    await ensureCheckinNotifications(DEFAULT_ROUTINE, "07:00");
    const sent = schedule.mock.calls[0]![0] as { notifications: { actionTypeId?: string }[] };
    expect(sent.notifications.every((n) => n.actionTypeId === undefined)).toBe(true);
  });
});
