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
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: () => checkPermissions(),
    requestPermissions: () => requestPermissions(),
    schedule: (o: unknown) => schedule(o),
    cancel: (o: unknown) => cancel(o),
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
}));

import { ensureCheckinNotifications, ensureEventReminders, ensureTaskReminders } from "./notifications";

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
