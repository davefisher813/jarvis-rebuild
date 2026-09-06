// @vitest-environment jsdom
// TODAY-F-14 (2026-09-05): a failed first load left the skeleton up forever.
// reload() had no catch and cleared `loading` only on its success path, so a
// first launch with no signal (or any throw in the heal or the reads) was a
// skeleton with no card and no retry until another tab was visited. The
// page now renders with what it has and the toast carries the retry.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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

// TODAY-F-11 (2026-09-05): "Undo after deleting an event from Today restores a
// stripped copy." The undo re-created the event from seven hand-copied
// fields, so a repeating block came back with no end date, no attached tasks,
// no Training Door, no skipped days and a new id.
describe("TodayFlow: Undo after deleting an event (TODAY-F-11)", () => {
  it("puts the whole event back, under its own id", async () => {
    const { useSchedule } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_EVENT } = await import("../schedule/types");
    const { todayISO, addDays } = await import("../schedule/calendar");
    let sched: ScheduleService | null = null;
    function Grab() { sched = useSchedule(); return null; }
    render(
      <NotesProvider userId="today-undo-event">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Grab />
          <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    // Tomorrow, where Today lists it whatever the clock says.
    const id = (await sched!.createEvent("Lift", {
      date: tomorrow, start: "17:30", end: "18:30", recurrence: "daily",
      until: addDays(today, 60), taskIds: ["t1"],
    }))!;
    await sched!.editGymDoor(id, true);
    await sched!.addExdate(id, addDays(today, 4));
    notifyFreshLists(ENTITY_EVENT);
    await waitFor(() => expect(screen.getByText("Lift")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lift"));
    await screen.findByText("Edit Event");
    fireEvent.click(screen.getByText("Delete Event"));
    await waitFor(() => expect(showToast.mock.calls.some((c) => (c[0] as { message: string }).message === "Event deleted")).toBe(true));
    expect(await sched!.event(id)).toBeNull();
    const call = showToast.mock.calls.find((c) => (c[0] as { message: string }).message === "Event deleted")![0] as { onAction: () => Promise<void> };
    await act(async () => { await call.onAction(); });
    const back = (await sched!.event(id))!;
    expect(back.gym).toBe(true);
    expect(back.until).toBe(addDays(today, 60));
    expect(back.taskIds).toEqual(["t1"]);
    expect(back.exdates).toEqual([addDays(today, 4)]);
  });
});

// UP-CORE-09 (2026-09-05): the Momentum Chain, on the tab where ticks happen.
// momentum.ts shipped with item 7 and was wired to the Tasks tab alone, so a
// tick on Today bought a toast and the next small thing stayed four taps away.
describe("TodayFlow: the Momentum Chain (UP-CORE-09)", () => {
  it("offers the next best thing after a tick, and Not Now takes it back", async () => {
    const { useTasks } = await import("../data/NotesProvider");
    const { notifyFreshLists } = await import("../data/store");
    const { ENTITY_TASK } = await import("../notes/types");
    const { todayISO } = await import("../schedule/calendar");
    let svc: import("../tasks/TasksService").TasksService | null = null;
    function Grab() { svc = useTasks(); return null; }
    render(
      <NotesProvider userId="today-momentum">
        <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
          <Grab />
          <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
        </GoogleSessionProvider>
      </NotesProvider>,
    );
    const today = todayISO();
    await svc!.createTask("Email the coach", { category: "c1", due: today, estimateMin: 15 });
    await svc!.createTask("Book the field", { category: "c1", due: today, estimateMin: 15 });
    notifyFreshLists(ENTITY_TASK);
    await waitFor(() => expect(screen.getByText("Book the field")).toBeInTheDocument());

    // Tick the dealt task; the chain fills the slot it left.
    fireEvent.click(screen.getAllByLabelText("Mark done")[0]!);
    await waitFor(() => expect(screen.getByText(/Keep going/)).toBeInTheDocument());
    // The task's own length is what makes it startable (UP-CORE-02).
    expect(screen.getAllByText(/15m/).length).toBeGreaterThan(0);

    // Waving it off empties the slot. Two of those quiet the chain for the
    // day, which is momentum.ts's own rule, unchanged.
    const chain = screen.getByText(/Keep going/).closest(".notice-swipe")!;
    fireEvent.click(chain.querySelector(".notice-dismiss")!);
    await waitFor(() => expect(screen.queryByText(/Keep going/)).toBeNull());
  });
});
