// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { Capacitor } from "@capacitor/core";
import { ProfileService } from "../profile/ProfileService";
import { subscribeToast } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import * as notifications from "../shared/notifications";
import * as webPush from "../shared/webPush";
import { reasonFor } from "../shared/webPush";
import NotificationsPage from "./NotificationsPage";

describe("NotificationsPage", () => {
  it("toggles a pref off", async () => {
    render(<NotesProvider userId="u1"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const row = (await screen.findByText("Today's events")).closest(".row")!;
    const sw = row.querySelector(".switch")!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
  });

  // S1-03 (2026-09-04): "The events switch cannot work on its own." Turning
  // off Daily check-ins used to leave nothing that ever asked for the OS
  // permission, so an events-only user was permanently blocked with no
  // explanation. This page is now the one place that asks, on any switch's
  // off-to-on edge, whichever switch it is.
  it("asks for notification permission on the off-to-on edge, not the on-to-off one", async () => {
    const spy = vi.spyOn(notifications, "requestNotificationPermission").mockResolvedValue(true);
    render(<NotesProvider userId="u1"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const row = (await screen.findByText("Today's events")).closest(".row")!;
    const sw = row.querySelector(".switch")!;
    fireEvent.click(sw); // on -> off
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(sw); // off -> on
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // SHELL-F-14 (2026-09-05): the switch flipped, the write failed, nothing
  // said so, and the old setting was back at the next launch.
  it("a switch whose write fails goes back and says so", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    const save = vi.spyOn(ProfileService.prototype, "save").mockRejectedValue(new Error("network"));
    render(<NotesProvider userId="u1"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const row = (await screen.findByText("Today's events")).closest(".row")!;
    const sw = row.querySelector(".switch")!;
    fireEvent.click(sw);
    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    expect(sw.getAttribute("aria-checked")).toBe("true");
    save.mockRestore();
    stop();
  });
});

// SHARED-F-02 (2026-09-05): the page discarded the permission answer and
// promised alerts regardless. With notifications denied in iOS Settings the
// four switches turned on, saved, and nothing ever arrived.
describe("NotificationsPage tells the truth about the OS permission", () => {
  const onPhone = () => vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
  afterEach(() => vi.restoreAllMocks());

  it("says notifications are off in Settings, and locks the switches", async () => {
    onPhone();
    vi.spyOn(notifications, "notificationPermissionState").mockResolvedValue("denied");
    render(<NotesProvider userId="u-notif-denied"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/Notifications are off for JARVIS in iOS Settings/)).toBeInTheDocument());
    expect(screen.queryByText(/arrive on this phone/)).not.toBeInTheDocument();
    const row = (await screen.findByText("Today's events")).closest(".row")!;
    expect(row.querySelector(".switch-locked")).not.toBeNull();
  });

  it("keeps the promise only when the OS has actually granted it", async () => {
    onPhone();
    vi.spyOn(notifications, "notificationPermissionState").mockResolvedValue("granted");
    render(<NotesProvider userId="u-notif-granted"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/arrive on this phone/)).toBeInTheDocument());
    const row = (await screen.findByText("Today's events")).closest(".row")!;
    expect(row.querySelector(".switch-locked")).toBeNull();
  });

  it("says the ask is coming when iOS has not been asked yet", async () => {
    onPhone();
    vi.spyOn(notifications, "notificationPermissionState").mockResolvedValue("prompt");
    render(<NotesProvider userId="u-notif-prompt"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/iOS will ask to allow notifications/)).toBeInTheDocument());
  });
});

// THE REMINDERS REBUILD (push D): "morning" is one setting for the whole
// app, and a test send says what happened on this phone.
describe("NotificationsPage, reminders", () => {
  afterEach(() => vi.restoreAllMocks());

  it("the morning time is remembered app-wide", async () => {
    window.localStorage.removeItem("jarvis.reminders.morning.v1");
    render(<NotesProvider userId="u1"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const menu = await screen.findByLabelText("Morning time");
    expect(menu.textContent).toContain("8:00 AM");
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "6:30 AM" }));
    expect(window.localStorage.getItem("jarvis.reminders.morning.v1")).toBe("06:30");
  });

  it("on the web there is no test row; on the phone it sends and says so", async () => {
    const { unmount } = render(<NotesProvider userId="u1"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    await screen.findByLabelText("Morning time");
    expect(screen.queryByText("Send a Test Reminder")).toBeNull();
    unmount();
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.spyOn(notifications, "notificationPermissionState").mockResolvedValue("granted");
    const send = vi.spyOn(notifications, "sendTestReminder").mockResolvedValue("sent");
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    render(<NotesProvider userId="u1"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Send a Test Reminder"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    // Casing sweep 3 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "About 1 Min").
    await waitFor(() => expect(seen.some((m) => m.startsWith("Test Reminder in"))).toBe(true));
    stop();
  });
});

// AUDIT 2026-09-29: on the web the "Alerts on this phone" switch needs OS or
// browser permission and, in a Safari tab, a Home Screen launch. When it
// cannot turn on it stayed off with nothing on screen saying why.
describe("NotificationsPage, the Alerts switch says why it will not turn on", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the reason on the row and again as a toast when tapped", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    vi.spyOn(webPush, "currentStatus").mockResolvedValue("denied");
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    render(<NotesProvider userId="u-alerts-denied"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const sw = await screen.findByRole("switch", { name: "Alerts on this phone" });
    await waitFor(() => expect(sw).toHaveAttribute("aria-disabled", "true"));
    const row = sw.closest(".row")!;
    expect(row.textContent).toContain(reasonFor("denied"));
    expect(row.textContent).toContain("phone or browser settings");
    fireEvent.click(sw);
    expect(seen).toContain(reasonFor("denied"));
    expect(sw).toHaveAttribute("aria-checked", "false");
    stop();
  });

  it("a Safari tab is told to add JARVIS to the Home Screen, on the row", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    vi.spyOn(webPush, "currentStatus").mockResolvedValue("not-standalone");
    render(<NotesProvider userId="u-alerts-tab"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const sw = await screen.findByRole("switch", { name: "Alerts on this phone" });
    await waitFor(() => expect(sw.closest(".row")!.textContent).toContain("Home Screen"));
  });

  it("a switch that can be turned on carries no reason and no lock", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    vi.spyOn(webPush, "currentStatus").mockResolvedValue("off");
    render(<NotesProvider userId="u-alerts-off"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const sw = await screen.findByRole("switch", { name: "Alerts on this phone" });
    await waitFor(() => expect(sw).not.toHaveAttribute("aria-disabled"));
    expect(sw.closest(".row")!.querySelector(".conn-meta")).toBeNull();
  });
});
