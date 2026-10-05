// @vitest-environment jsdom
// 2026-10-04: saving Reminder Settings wrote the profile and scheduled
// nothing, so the banners already queued on the phone kept the old Quiet Hours
// and Hide Sensitive Details until the next foreground. Saving re-arms now.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../../data/NotesProvider";
import RemindersFlow from "./RemindersFlow";

const armTaskReminders = vi.fn();
vi.mock("../armReminders", () => ({ armTaskReminders: (...a: unknown[]) => armTaskReminders(...a) }));
const showToast = vi.fn();
vi.mock("../../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

beforeEach(() => { armTaskReminders.mockReset(); armTaskReminders.mockResolvedValue(undefined); showToast.mockReset(); localStorage.clear(); });

function openSettings() {
  render(
    <NotesProvider userId={"rem-settings-" + Math.random().toString(36).slice(2)}>
      <RemindersFlow chrome={{ back: "Today", onBack: () => {} }} />
    </NotesProvider>,
  );
  fireEvent.click(screen.getByLabelText("Reminders Options"));
  fireEvent.click(screen.getByText("Reminder Settings"));
}

describe("RemindersFlow: Reminder Settings save", () => {
  it("re-arms the phone's reminders once the settings are saved", async () => {
    openSettings();
    fireEvent.click(screen.getByLabelText("Hide sensitive details"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "Reminder Settings Saved" }));
    expect(armTaskReminders).toHaveBeenCalledTimes(1);
  });

  it("a settings sheet closed without saving arms nothing", async () => {
    openSettings();
    fireEvent.click(screen.getByLabelText("Hide sensitive details"));
    fireEvent.click(screen.getByText("Cancel"));
    await new Promise((r) => setTimeout(r, 30));
    expect(armTaskReminders).not.toHaveBeenCalled();
  });
});
