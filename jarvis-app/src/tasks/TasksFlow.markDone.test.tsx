// @vitest-environment jsdom
// Issue 102, "completion does not persist from the Edit Task sheet", on the
// Tasks tab. The same three defects as on Today (a flip instead of a set, a
// sheet that closes over a failed or refused write, silence), plus the one
// that is this tab's own: the Done filter opens the same sheet on a FINISHED
// task, and its Mark Done reopened what it listed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "./TasksService";
import TasksFlow from "./TasksFlow";
import { todayISO } from "./grouping";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

let seen: ToastState[] = [];
let stop: () => void = () => {};

async function mountWithTask(title: string, opts: { recurrence?: "daily"; done?: boolean; openFilter?: string } = {}) {
  const userId = "tasks-markdone-" + Math.random().toString(36).slice(2);
  const store = new Store(new InMemoryAdapter());
  const svc = new TasksService(store, userId);
  const id = (await svc.createTask(title, { due: todayISO(), ...(opts.recurrence ? { recurrence: opts.recurrence } : {}) }))!;
  if (opts.done) await svc.toggleDone(id);
  render(
    <NotesProvider userId={userId} store={store}>
      <TasksFlow {...(opts.openFilter ? { openFilter: opts.openFilter } : {})} />
    </NotesProvider>,
  );
  return { store, svc, id };
}

const rowNamed = (name: string) => screen.getAllByText(name).find((el) => !el.classList.contains("start-top-name")) as HTMLElement;
const openSheet = async (name: string) => {
  await waitFor(() => expect(rowNamed(name)).toBeInTheDocument());
  fireEvent.click(rowNamed(name));
  await screen.findByText("Edit Task");
};
const sheetGone = () => waitFor(() => expect(screen.queryByText("Edit Task")).not.toBeInTheDocument());
const withUndo = () => seen.find((t) => t.actionLabel === "Undo");

function refuseCompletion(store: Store, how: "throw" | "false") {
  const real = store.update.bind(store);
  vi.spyOn(store, "update").mockImplementation((o, i, patch) => {
    const p = patch as Record<string, unknown>;
    if ("done" in p || "lastDone" in p) return how === "throw" ? Promise.reject(new Error("offline")) : Promise.resolve(false);
    return real(o, i, patch);
  });
}

describe("TasksFlow: Mark Done from the Edit Task sheet (issue 102)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetToasts();
    seen = [];
    stop = subscribeToast((t) => { if (t) seen.push(t); });
  });
  afterEach(() => { stop(); vi.restoreAllMocks(); });

  it("finishes the task, closes the sheet, and the toast's Undo puts it back", async () => {
    const { svc, id } = await mountWithTask("send invoice");
    await openSheet("Send Invoice");
    fireEvent.click(screen.getByText("Mark Done"));
    await sheetGone();
    await waitFor(async () => expect((await svc.task(id))!.done).toBe(true));
    await waitFor(() => expect(withUndo(), "the sheet used to close in silence").toBeTruthy());
    await withUndo()!.onAction!();
    expect((await svc.task(id))!.done).toBe(false);
  });

  it("does not reopen a task that was finished behind the sheet's back", async () => {
    const { svc, id } = await mountWithTask("send invoice");
    await openSheet("Send Invoice");
    await svc.toggleDone(id);
    fireEvent.click(screen.getByText("Mark Done"));
    await sheetGone();
    expect((await svc.task(id))!.done, "Mark Done flipped a finished task back to active").toBe(true);
  });

  it.each(["throw", "false"] as const)("a write that %s keeps the sheet open, says so, and gives Save back", async (how) => {
    const { store, svc, id } = await mountWithTask("send invoice");
    await openSheet("Send Invoice");
    refuseCompletion(store, how);
    fireEvent.click(screen.getByText("Mark Done"));
    await waitFor(() => expect(seen.map((t) => t.message)).toContain(WRITE_FAILED_MESSAGE));
    expect(screen.getByText("Edit Task"), "the sheet closed over a failed save and took the draft").toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    vi.restoreAllMocks();
    expect((await svc.task(id))!.done).toBe(false);
  });

  it("a repeating task rolls, and the toast says so", async () => {
    const { svc, id } = await mountWithTask("take vitamins", { recurrence: "daily" });
    await openSheet("Take Vitamins");
    fireEvent.click(screen.getByText("Mark Done"));
    await sheetGone();
    await waitFor(async () => expect((await svc.task(id))!.lastDone).toBe(todayISO()));
    await waitFor(() => expect(seen.map((t) => t.message)).toContain("Checked Off For Today · Next Due Tomorrow"));
    expect(withUndo()).toBeTruthy();
  });

  it("a finished task opened from Done draws no Quick Actions, and stays finished", async () => {
    const { svc, id } = await mountWithTask("send invoice", { done: true, openFilter: "done" });
    await openSheet("Send Invoice");
    expect(document.querySelector(".xs-do")).toBeNull();
    expect(screen.queryByText("Quick Actions")).not.toBeInTheDocument();
    expect(screen.queryByText("Mark Done")).not.toBeInTheDocument();
    expect(screen.queryByText("Start")).not.toBeInTheDocument();
    // Its other groups are untouched: the sheet is still the task's sheet.
    expect(screen.getByLabelText("Task")).toHaveValue("Send Invoice");
    fireEvent.click(screen.getByText("Save"));
    await sheetGone();
    expect((await svc.task(id))!.done).toBe(true);
  });

  it("an open task still offers Start, Move to Tomorrow and Mark Done", async () => {
    await mountWithTask("send invoice");
    await openSheet("Send Invoice");
    expect([...document.querySelectorAll(".xs-do .conn-name")].map((n) => n.textContent)).toEqual(["Start", "Move to Tomorrow", "Mark Done"]);
  });
});
