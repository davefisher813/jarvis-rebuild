// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { Capacitor } from "@capacitor/core";
import * as notifications from "../shared/notifications";
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
