// @vitest-environment jsdom
// WRAP UP ON A BLOCK WHOSE TASK IS ALREADY DONE (issue 108, Focus full screen).
//
// Focus now stays open behind a running 15 Min block, so the same task can be finished from its face card while the block is
// still live. The block's own Done used to TOGGLE the task, which reopened the task he had just finished. Done is not a flip:
// a task that is already done only has its block ended.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { todayISO } from "../schedule/calendar";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "../tasks/TasksService";
import TodayFlow from "./TodayFlow";
import { writeFifteen } from "./liveFifteen";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const KEY = "jarvis.today.fifteen.v1";

async function mountWithRunningBlock(text: string) {
  const userId = "fifteen-done-" + Math.random().toString(36).slice(2);
  const store = new Store(new InMemoryAdapter());
  const svc = new TasksService(store, userId);
  const id = (await svc.createTask(text, { category: "c1", due: todayISO() }))!;
  writeFifteen({ taskId: id, text, startedAt: Date.now(), startHHMM: "09:00", date: todayISO(), minutes: 15, rounds: 1 });
  render(
    <NotesProvider userId={userId} store={store}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
  const wrapUp = await waitFor(() => {
    const b = screen.getAllByRole("button", { name: /Wrap Up/ })[0];
    if (!b) throw new Error("the running block's Wrap Up is not on Today yet");
    return b;
  });
  return { svc, id, wrapUp };
}

describe("TodayFlow: Wrap Up on a running block (issue 108)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(todayISO() + "T09:00:00"));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

  it("finishes the task and ends the block", async () => {
    const { svc, id, wrapUp } = await mountWithRunningBlock("Call the Bank");
    expect((await svc.task(id))?.done).toBe(false);
    fireEvent.click(wrapUp);
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    await waitFor(async () => expect((await svc.task(id))?.done).toBe(true));
  });

  it("leaves a task that was already finished (from the Focus face card) finished, and still ends the block", async () => {
    const { svc, id, wrapUp } = await mountWithRunningBlock("Call the Bank");
    // The task is completed elsewhere while its block is live.
    await svc.toggleDone(id);
    expect((await svc.task(id))?.done).toBe(true);
    fireEvent.click(wrapUp);
    await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    // The old chain flipped it back to open here.
    expect((await svc.task(id))?.done).toBe(true);
  });
});
