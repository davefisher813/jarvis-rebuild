// @vitest-environment jsdom
// 2026-10-04: Today and the app shell both arm the phone's task reminders into
// one id block, and the last caller wins. Today's call used to carry neither
// Hide Sensitive Details nor Quiet Hours and fires on every reload, so it
// undid both whenever Today was mounted. This mounts the real TodayFlow with
// the settings saved and reads what it asked the scheduler for.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useProfile, useCategories } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { setCategoryRegistry } from "../shared/categories";
import type { AIService } from "../ai/AIService";
import TodayFlow from "./TodayFlow";

const ensureTaskReminders = vi.fn();
vi.mock("../shared/notifications", async () => {
  const actual = await vi.importActual<typeof import("../shared/notifications")>("../shared/notifications");
  return { ...actual, ensureTaskReminders: (...a: unknown[]) => ensureTaskReminders(...a) };
});
vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
vi.mock("../people/MessageDraftSheet", () => ({ default: () => null }));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

function Seeded() {
  const tasks = useTasks();
  const profile = useProfile();
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const health = await cats.create("Health", "green");
      await tasks.createTask("Take Meds", { category: health ?? undefined, reminder: { time: "09:00" } });
      await profile.save({ notify: { overdue: true, events: true, goals: true, privateAlerts: true, quietHours: true, quietFrom: "22:00", quietTo: "07:00" } });
      setReady(true);
    })();
  }, [tasks, profile, cats]);
  return ready ? <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} /> : null;
}

beforeEach(() => { ensureTaskReminders.mockReset(); ensureTaskReminders.mockResolvedValue(undefined); localStorage.clear(); setCategoryRegistry([]); });
afterEach(() => { vi.restoreAllMocks(); });

describe("Today arms task reminders with the person's Reminder Settings", () => {
  it("a health reminder is sensitive and the quiet window rides along", async () => {
    render(
      <NotesProvider userId={"today-arm-" + Math.random().toString(36).slice(2)}>
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Seeded />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    await waitFor(() => {
      const withReminder = ensureTaskReminders.mock.calls.filter((c) => (c[0] as unknown[]).length > 0);
      expect(withReminder.length).toBeGreaterThan(0);
    });
    for (const call of ensureTaskReminders.mock.calls.filter((c) => (c[0] as unknown[]).length > 0)) {
      expect((call[0] as { text: string; sensitive?: boolean }[])[0]).toEqual(expect.objectContaining({ text: "Take Meds", sensitive: true }));
      expect(call[3]).toEqual({ quietFrom: "22:00", quietTo: "07:00" });
    }
  });
});
