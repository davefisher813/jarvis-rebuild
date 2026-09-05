// @vitest-environment jsdom
// TODAY-F-14 (2026-09-05): a failed first load left the skeleton up forever.
// reload() had no catch and cleared `loading` only on its success path, so a
// first launch with no signal (or any throw in the heal or the reads) was a
// skeleton with no card and no retry until another tab was visited. The
// page now renders with what it has and the toast carries the retry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { ScheduleService } from "../schedule/ScheduleService";
import TodayFlow from "./TodayFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

function mount() {
  return render(
    <NotesProvider userId={"today-fail-" + Math.random().toString(36).slice(2)}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

beforeEach(() => { showToast.mockReset(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("TodayFlow first load failure (TODAY-F-14)", () => {
  it("drops the skeleton, renders the page, and offers Retry on the toast", async () => {
    vi.spyOn(ScheduleService.prototype, "healPlanDuplicates").mockRejectedValueOnce(new Error("no signal"));
    const { container } = mount();
    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    const call = showToast.mock.calls[0]![0] as { message: string; actionLabel?: string; onAction?: () => void };
    expect(call.message).toBe("Couldn't load today · Check your connection");
    expect(call.actionLabel).toBe("Retry");
    await waitFor(() => expect(container.querySelector(".skel-screen")).toBeNull());
    expect(container.querySelector(".screen")).not.toBeNull();

    // Signal is back: Retry re-runs the load and nothing complains again.
    await act(async () => { call.onAction!(); });
    await new Promise((r) => setTimeout(r, 50));
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("a load that answers shows no toast and no skeleton", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".skel-screen")).toBeNull());
    expect(showToast).not.toHaveBeenCalled();
  });
});
