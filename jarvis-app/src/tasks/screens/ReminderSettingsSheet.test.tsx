// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReminderSettingsSheet, { DEFAULT_REMINDER_PREFS } from "./ReminderSettingsSheet";

// REMINDER SETTINGS (push E): quiet hours, the default follow-up, private
// alerts, the morning, and the test send on the phone only.
describe("ReminderSettingsSheet", () => {
  it("saves what was flipped, with the quiet window and the morning", () => {
    const onSave = vi.fn();
    window.localStorage.removeItem("jarvis.reminders.morning.v1");
    render(<ReminderSettingsSheet initial={DEFAULT_REMINDER_PREFS} native={false} permission="unsupported" onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText("Quiet hours"));
    fireEvent.change(screen.getByLabelText("Quiet from"), { target: { value: "22:00" } });
    fireEvent.click(screen.getByLabelText("Default follow-up"));
    fireEvent.click(screen.getByLabelText("Hide sensitive details"));
    fireEvent.click(screen.getByLabelText("Morning time"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "7:00 AM" }));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ quietHours: true, quietFrom: "22:00", quietTo: "08:00", defaultFollowUp: true, privateAlerts: true }, "07:00");
    expect(window.localStorage.getItem("jarvis.reminders.morning.v1")).toBe("07:00");
  });
  it("on the web there is no test row and the note says why; on the phone the row sends", () => {
    const onTest = vi.fn();
    const r = render(<ReminderSettingsSheet initial={DEFAULT_REMINDER_PREFS} native={false} permission="unsupported" onSave={() => {}} onTest={onTest} onCancel={() => {}} />);
    expect(screen.queryByText("Send a Test Reminder")).toBeNull();
    expect(screen.getByText(/Alerts need the phone app/)).toBeInTheDocument();
    r.unmount();
    render(<ReminderSettingsSheet initial={DEFAULT_REMINDER_PREFS} native={true} permission="granted" onSave={() => {}} onTest={onTest} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Send a Test Reminder"));
    expect(onTest).toHaveBeenCalled();
  });
});
