// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
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
