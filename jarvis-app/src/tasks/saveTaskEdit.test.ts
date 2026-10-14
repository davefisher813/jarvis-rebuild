import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Store, InMemoryAdapter } from "@core";
import { TasksService } from "./TasksService";
import { saveTaskEdit, completionLine } from "./saveTaskEdit";
import { todayISO } from "./grouping";
import { addDays } from "../schedule/calendar";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import type { TaskDraft } from "./screens/TaskSheet";

// Issue 102. The one chain behind the Edit Task sheet on Today, Tasks, Schedule
// and a project's page. The four screens used to carry a copy each; this is the
// only place a field is written, so it is the place a missed field is caught.

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

type Toast = { message: string; actionLabel?: string; onAction?: () => Promise<void> };
const toasts = () => showToast.mock.calls.map((c) => c[0] as Toast);

function setup() {
  const store = new Store(new InMemoryAdapter());
  const svc = new TasksService(store, "u");
  const reload = vi.fn(async () => {});
  return { store, svc, reload };
}

beforeEach(() => { showToast.mockClear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("saveTaskEdit: every field the sheet shows is written", () => {
  it("writes the whole draft", async () => {
    const { svc, reload } = setup();
    const id = (await svc.createTask("Old Title", { category: "c0", due: todayISO() }))!;
    const draft: Required<Omit<TaskDraft, "closeNow">> = {
      text: "New Title", category: "c1", extraCategories: ["c2"], due: addDays(todayISO(), 3), repeat: "weekly",
      projectId: "p1", goalId: "g1", eventId: "e1",
      plan: { cue: { kind: "time", what: "13:00" }, then: "Call Marco" },
      steps: [{ text: "Find the number", done: false }],
      notes: "Ask about Saturday.", estimateMin: 25, priority: "high", personId: "pe1",
    };
    expect(await saveTaskEdit(svc, id, draft, { reload })).toBe(true);
    const t = (await svc.task(id))!;
    expect(t.text).toBe("New Title");
    expect(t.category).toBe("c1");
    expect(t.extraCategories).toEqual(["c2"]);
    expect(t.due).toBe(draft.due);
    expect(t.recurrence).toBe("weekly");
    expect(t.projectId).toBe("p1");
    expect(t.goalId).toBe("g1");
    expect(t.eventId).toBe("e1");
    expect(t.plan).toEqual(draft.plan);
    expect(t.steps).toEqual([{ text: "Find the number", done: false }]);
    expect(t.notes).toBe("Ask about Saturday.");
    expect(t.estimateMin).toBe(25);
    expect(t.priority).toBe("high");
    expect(t.personId).toBe("pe1");
    // A plain Save finishes nothing and says nothing.
    expect(t.done).toBeFalsy();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("saveTaskEdit: priority", () => {
  it("Normal clears a High mark, and Low is kept", async () => {
    const { svc, reload } = setup();
    const id = (await svc.createTask("Pay Rent", { due: todayISO(), priority: "high" }))!;
    expect((await svc.task(id))!.priority).toBe("high");
    const base = { text: "Pay Rent", category: "", due: todayISO(), repeat: "" };
    expect(await saveTaskEdit(svc, id, { ...base, priority: "low" }, { reload })).toBe(true);
    expect((await svc.task(id))!.priority).toBe("low");
    expect(await saveTaskEdit(svc, id, base, { reload })).toBe(true);
    expect((await svc.task(id))!.priority).toBeUndefined();
  });
});

describe("saveTaskEdit: closing the task", () => {
  const draft = (text: string): TaskDraft => ({ text, category: "", due: todayISO(), repeat: "" });

  it("sets it done and offers an Undo that restores the state read before", async () => {
    const { svc, reload } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    expect(await saveTaskEdit(svc, id, draft("Send Invoice"), { closeNow: true, reload })).toBe(true);
    expect((await svc.task(id))!.done).toBe(true);
    const t = toasts().find((x) => x.actionLabel === "Undo")!;
    expect(t.message).toBeTruthy();
    await t.onAction!();
    expect((await svc.task(id))!.done).toBe(false);
    expect(reload).toHaveBeenCalled();
  });

  it("a task already done stays done, says so, and offers no Undo", async () => {
    const { svc, reload } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    await svc.toggleDone(id);
    expect(await saveTaskEdit(svc, id, draft("Send Invoice"), { closeNow: true, reload })).toBe(true);
    expect((await svc.task(id))!.done).toBe(true);
    expect(toasts()).toEqual([{ message: "Already Done" }]);
  });

  it("a repeating task rolls and the toast names the date", async () => {
    const { svc, reload } = setup();
    const id = (await svc.createTask("Take Vitamins", { due: todayISO(), recurrence: "daily" }))!;
    expect(await saveTaskEdit(svc, id, { ...draft("Take Vitamins"), repeat: "daily" }, { closeNow: true, reload })).toBe(true);
    expect(toasts()[0]!.message).toBe("Checked Off For Today · Next Due Tomorrow");
    expect(toasts()[0]!.actionLabel).toBe("Undo");
  });

  it("a completion the store refuses is a failure: false, a toast, a reload, no success line", async () => {
    const { store, svc, reload } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    const real = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementation((o, i, p) => ("done" in (p as object) ? Promise.resolve(false) : real(o, i, p)));
    expect(await saveTaskEdit(svc, id, draft("Send Invoice"), { closeNow: true, reload })).toBe(false);
    expect(toasts().map((t) => t.message)).toEqual([WRITE_FAILED_MESSAGE]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a task deleted behind the sheet is a failure, not a silent close", async () => {
    const { svc, reload } = setup();
    expect(await saveTaskEdit(svc, "gone", draft("Send Invoice"), { closeNow: true, reload })).toBe(false);
    expect(toasts().map((t) => t.message)).toEqual([WRITE_FAILED_MESSAGE]);
  });

  it("a field write that throws is a failure too", async () => {
    const { svc, reload } = setup();
    const id = (await svc.createTask("Send Invoice", { due: todayISO() }))!;
    vi.spyOn(svc, "setNotes").mockRejectedValue(new Error("offline"));
    expect(await saveTaskEdit(svc, id, draft("Send Invoice"), { reload })).toBe(false);
    expect(toasts().map((t) => t.message)).toEqual([WRITE_FAILED_MESSAGE]);
  });
});

describe("completionLine: the wording", () => {
  it("is Title Case, with no dash and no landed word", () => {
    const lines = [
      completionLine({ ok: true, rolled: true, changed: true, nextDue: addDays(todayISO(), 1) }, "a"),
      completionLine({ ok: true, rolled: true, changed: true, nextDue: addDays(todayISO(), 9) }, "a"),
      completionLine({ ok: true, rolled: true, changed: false, nextDue: addDays(todayISO(), 1) }, "a"),
      completionLine({ ok: true, rolled: false, changed: false }, "a"),
      completionLine({ ok: true, rolled: false, changed: true }, "a"),
    ];
    for (const l of lines) {
      expect(l).not.toMatch(/[–—-]/);
      expect(l).not.toMatch(/\b(saved|filed|added)\b/i);
      for (const w of l.split(/[\s·]+/).filter((x) => /^[a-z]/i.test(x))) expect(w[0]).toBe(w[0]!.toUpperCase());
    }
    expect(lines[0]).toBe("Checked Off For Today · Next Due Tomorrow");
    expect(lines[1]).toMatch(/^Checked Off For Today · Next Due [A-Z][a-z]{2} \d{1,2}$/);
    expect(lines[2]).toBe("Already Checked Off For Today · Next Due Tomorrow");
    expect(lines[3]).toBe("Already Done");
  });
});
