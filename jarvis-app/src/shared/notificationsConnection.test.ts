import { describe, it, expect, vi, beforeEach } from "vitest";

// THE CONNECTION INCIDENT NOTIFICATION (Foundation Fix Spec 3): one reserved id,
// replaced rather than stacked, permission-gated, withdrawn on recovery, and
// carrying no address, subject, recipient or message text.
const isNativePlatform = vi.fn(() => true);
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => isNativePlatform() } }));

const checkPermissions = vi.fn();
const schedule = vi.fn();
const cancel = vi.fn();
const removeDelivered = vi.fn();
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: () => checkPermissions(),
    requestPermissions: vi.fn(),
    schedule: (o: unknown) => schedule(o),
    cancel: (o: unknown) => cancel(o),
    removeDeliveredNotifications: (o: unknown) => removeDelivered(o),
    registerActionTypes: vi.fn().mockResolvedValue(undefined),
    addListener: () => Promise.resolve({ remove: () => {} }),
  },
}));

import { CONNECTION_ID, MORNING_ID, EVENING_ID, REST_OVER_ID, TEST_REMINDER_ID, connectionNoticeText, kindOfNotification, postConnectionIncident, withdrawConnectionIncident } from "./notifications";

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  for (const m of [checkPermissions, schedule, cancel, removeDelivered]) m.mockReset();
  checkPermissions.mockResolvedValue({ display: "granted" });
  schedule.mockResolvedValue(undefined);
  cancel.mockResolvedValue(undefined);
  removeDelivered.mockResolvedValue(undefined);
});

describe("the connection incident notification", () => {
  it("has its own id, clear of the check-ins, the rest timer and the test reminder, and a tap on it is the connection kind", () => {
    expect(new Set([CONNECTION_ID, MORNING_ID, EVENING_ID, REST_OVER_ID, TEST_REMINDER_ID]).size).toBe(5);
    expect(kindOfNotification(CONNECTION_ID)).toBe("connection");
  });

  it("carries the incident ID and nothing about the mail: no address, subject, recipient or text", () => {
    const one = connectionNoticeText({ incidentIds: ["JC-0A1B2C3D"], kind: "auth" });
    expect(one).toEqual({ title: "Gmail Needs Reconnecting", body: "Incident JC-0A1B2C3D · Tap to Open JARVIS" });
    expect(JSON.stringify(one)).not.toMatch(/@/);
    const two = connectionNoticeText({ incidentIds: ["JC-AAAAAAAA", "JC-BBBBBBBB"], kind: "auth" });
    expect(two.body).toBe("2 Accounts · Incidents JC-AAAAAAAA, JC-BBBBBBBB");
    expect(connectionNoticeText({ incidentIds: ["JC-AAAAAAAA"], kind: "degraded" }).title).toBe("Gmail Isn't Updating");
  });

  it("replaces the previous one (cancel, then schedule on the same id) a moment from now", async () => {
    await postConnectionIncident({ incidentIds: ["JC-0A1B2C3D"], kind: "auth" }, 1_000_000);
    expect(cancel).toHaveBeenCalledWith({ notifications: [{ id: CONNECTION_ID }] });
    const sent = schedule.mock.calls[0]![0].notifications[0];
    expect(sent.id).toBe(CONNECTION_ID);
    expect(sent.schedule.at.getTime()).toBe(1_001_000);
    expect(sent.extra).toEqual({ incidents: "JC-0A1B2C3D" });
    expect(cancel.mock.invocationCallOrder[0]!).toBeLessThan(schedule.mock.invocationCallOrder[0]!);
  });

  it("never asks for permission and posts nothing without it", async () => {
    checkPermissions.mockResolvedValue({ display: "denied" });
    await postConnectionIncident({ incidentIds: ["JC-0A1B2C3D"], kind: "auth" });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does nothing off a phone, and for an empty set", async () => {
    isNativePlatform.mockReturnValue(false);
    await postConnectionIncident({ incidentIds: ["JC-0A1B2C3D"], kind: "auth" });
    await withdrawConnectionIncident();
    isNativePlatform.mockReturnValue(true);
    await postConnectionIncident({ incidentIds: [], kind: "auth" });
    expect(schedule).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("withdraws both a pending and an already delivered banner on recovery", async () => {
    await withdrawConnectionIncident();
    expect(cancel).toHaveBeenCalledWith({ notifications: [{ id: CONNECTION_ID }] });
    expect(removeDelivered).toHaveBeenCalledWith({ notifications: [{ id: CONNECTION_ID, title: "", body: "" }] });
  });

  it("never throws into the app, whatever the OS does", async () => {
    schedule.mockRejectedValue(new Error("boom"));
    await expect(postConnectionIncident({ incidentIds: ["JC-0A1B2C3D"], kind: "auth" })).resolves.toBeUndefined();
    cancel.mockRejectedValue(new Error("boom"));
    await expect(withdrawConnectionIncident()).resolves.toBeUndefined();
  });
});
