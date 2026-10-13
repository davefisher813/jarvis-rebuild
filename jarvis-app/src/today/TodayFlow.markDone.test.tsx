// @vitest-environment jsdom
// Issue 102, "completion does not persist from the Edit Task sheet", on Today.
//
// Three defects shared one path. Mark Done was a FLIP (a task finished behind
// the sheet's back was reopened by the tap). The save chain reported success
// when the store refused the write, and closed the sheet when it threw. And the
// sheet closed in silence, so a repeating task (which rolls to its next date by
// design) just vanished from Today. Each case below fails on the old chain.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { todayISO } from "../schedule/calendar";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import TodayFlow from "./TodayFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

type Toast = { message: string; actionLabel?: string; onAction?: () => void | Promise<void> };
const toasts = (): Toast[] => showToast.mock.calls.map((c) => c[0] as Toast);

async function mountWithTask(text: string, opts: { recurrence?: "daily" } = {}) {
  const userId = "markdone-" + Math.random().toString(36).slice(2);
  const store = new Store(new InMemoryAdapter());
  const svc = new TasksService(store, userId);
  const id = (await svc.createTask(text, { category: "c1", due: todayISO(), ...opts }))!;
  render(
    <NotesProvider userId={userId} store={store}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
  await waitFor(() => expect(rowFor(text)).toBeTruthy());
  // The TV guide moves at all times and swallows a tap that would open a row:
  // hold it first, then tap.
  const hold = document.querySelector(".ticker-toggle") as HTMLElement | null;
  if (hold) fireEvent.click(hold);
  return { store, svc, id };
}

// The title can also sit in the moving TV guide (twice, for its loop), so the
// row to tap is the heads-up row's own title, not a text match.
const rowFor = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(".hl-title")).find((e) => e.textContent === text);
const openSheet = async (text: string) => {
  fireEvent.click(rowFor(text)!);
  await screen.findByText("Edit Task");
};
const sheetGone = () => waitFor(() => expect(screen.queryByText("Edit Task")).not.toBeInTheDocument());

/** Make the store answer a patch that carries `done` (or a roll's lastDone) another way. */
function refuseCompletion(store: Store, how: "throw" | "false") {
  const real = store.update.bind(store);
  vi.spyOn(store, "update").mockImplementation((o, i, patch) => {
    const p = patch as Record<string, unknown>;
    if ("done" in p || "lastDone" in p) return how === "throw" ? Promise.reject(new Error("offline")) : Promise.resolve(false);
    return real(o, i, patch);
  });
}

describe("TodayFlow: Mark Done from the Edit Task sheet (issue 102)", () => {
  beforeEach(() => {
    showToast.mockClear();
    localStorage.clear(); // Where You Were remembers the last sheet and would list the task twice
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(todayISO() + "T09:00:00"));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("finishes the task, closes the sheet, and the toast offers an Undo that puts it back", async () => {
    const { svc, id } = await mountWithTask("Send Invoice");
    await openSheet("Send Invoice");
    fireEvent.click(screen.getByText("Mark Done"));
    await sheetGone();
    await waitFor(async () => expect((await svc.task(id))!.done).toBe(true));
    const toast = toasts().find((t) => t.actionLabel === "Undo");
    expect(toast, "the sheet used to close in silence").toBeTruthy();
    await toast!.onAction!();
    expect((await svc.task(id))!.done).toBe(false);
  });

  it("does not reopen a task that was finished behind the sheet's back", async () => {
    const { svc, id } = await mountWithTask("Send Invoice");
    await openSheet("Send Invoice");
    await svc.toggleDone(id); // another surface finishes it while the sheet is open
    fireEvent.click(screen.getByText("Mark Done"));
    await sheetGone();
    expect((await svc.task(id))!.done, "Mark Done flipped a finished task back to active").toBe(true);
  });

  it("a write that throws keeps the sheet open, says so, and gives Save back", async () => {
    const { store, svc, id } = await mountWithTask("Send Invoice");
    await openSheet("Send Invoice");
    refuseCompletion(store, "throw");
    fireEvent.click(screen.getByText("Mark Done"));
    await waitFor(() => expect(toasts().map((t) => t.message)).toContain(WRITE_FAILED_MESSAGE));
    expect(screen.getByText("Edit Task"), "the sheet closed over a failed save and took the draft").toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    vi.restoreAllMocks();
    expect((await svc.task(id))!.done).toBe(false);
  });

  it("a write the store refuses (false) is a failure too, not a silent close", async () => {
    const { store, svc, id } = await mountWithTask("Send Invoice");
    await openSheet("Send Invoice");
    refuseCompletion(store, "false");
    fireEvent.click(screen.getByText("Mark Done"));
    await waitFor(() => expect(toasts().map((t) => t.message)).toContain(WRITE_FAILED_MESSAGE));
    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    vi.restoreAllMocks();
    expect((await svc.task(id))!.done).toBe(false);
  });

  it("after a failure, Mark Done tried again lands", async () => {
    const { store, svc, id } = await mountWithTask("Send Invoice");
    await openSheet("Send Invoice");
    refuseCompletion(store, "throw");
    fireEvent.click(screen.getByText("Mark Done"));
    await waitFor(() => expect(toasts().map((t) => t.message)).toContain(WRITE_FAILED_MESSAGE));
    vi.restoreAllMocks();
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Mark Done"));
    await sheetGone();
    expect((await svc.task(id))!.done).toBe(true);
  });

  it("a repeating task rolls, and the toast says so with an Undo that restores the exact fields", async () => {
    const { svc, id } = await mountWithTask("Take Vitamins", { recurrence: "daily" });
    const before = (await svc.task(id))!;
    await openSheet("Take Vitamins");
    fireEvent.click(screen.getByText("Mark Done"));
    await sheetGone();
    await waitFor(async () => expect((await svc.task(id))!.due).not.toBe(before.due));
    const rolled = (await svc.task(id))!;
    expect(rolled.done).toBe(false);
    expect(rolled.lastDone).toBe(todayISO());
    const toast = toasts().find((t) => /Checked Off For Today/.test(t.message));
    expect(toast?.message).toBe("Checked Off For Today · Next Due Tomorrow");
    expect(toast?.actionLabel).toBe("Undo");
    await toast!.onAction!();
    const back = (await svc.task(id))!;
    expect(back.due).toBe(before.due);
    expect(back.lastDone ?? null).toBe(before.lastDone ?? null);
    expect(back.doneCount ?? null).toBe(before.doneCount ?? null);
  });

  it("the green tile completes exactly once (set, not toggled)", async () => {
    const { svc, id } = await mountWithTask("Send Invoice");
    const spy = vi.spyOn(svc.constructor.prototype as TasksService, "completeTask");
    const flip = vi.spyOn(svc.constructor.prototype as TasksService, "toggleDone");
    await openSheet("Send Invoice");
    fireEvent.click(document.querySelector(".xs-do [aria-label='Mark done']") as HTMLElement);
    await sheetGone();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(flip, "the sheet must never flip").not.toHaveBeenCalled();
    expect((await svc.task(id))!.done).toBe(true);
  });
});
