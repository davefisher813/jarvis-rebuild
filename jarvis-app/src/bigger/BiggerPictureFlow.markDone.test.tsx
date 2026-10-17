// @vitest-environment jsdom
// Issue 102, parity on a project's page: a step opens the same Edit Task sheet,
// and Mark Done there sets the step done; a refused completion keeps the sheet
// open. The chain itself is pinned in saveTaskEdit.test.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProjects, useTasks } from "../data/NotesProvider";
import type { TasksService } from "../tasks/TasksService";
import { subscribeToast, resetToasts, type ToastState } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import BiggerPictureFlow from "./BiggerPictureFlow";

let ref: { tasks: TasksService; id: string } | null = null;
function Seed() {
  const projects = useProjects();
  const tasks = useTasks();
  const [pid, setPid] = useState("");
  useEffect(() => {
    void (async () => {
      const projectId = (await projects.create({ title: "Remodel", status: "active" }))!;
      ref = { tasks, id: (await tasks.createTask("Call the contractor", { projectId, due: "2099-01-01" }))! };
      setPid(projectId);
    })();
  }, [projects, tasks]);
  return pid ? <BiggerPictureFlow openId={pid} /> : null;
}

const openSheet = async () => {
  fireEvent.click(await screen.findByText("Call the Contractor"));
  await screen.findByText("Edit Task");
};
// The project's own page also has a Mark Done; the step's is the one in the sheet's action card.
const markDone = () => fireEvent.click([...document.querySelectorAll(".xs-do .conn-name")].find((n) => n.textContent === "Mark Done") as HTMLElement);

afterEach(() => { vi.restoreAllMocks(); });

describe("BiggerPictureFlow: Mark Done from a step's Edit Task sheet (issue 102)", () => {
  it("sets the step done, closes the sheet, and the toast offers Undo", async () => {
    resetToasts();
    const seen: ToastState[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t); });
    render(<NotesProvider userId="bigger-markdone-1"><Seed /></NotesProvider>);
    await openSheet();
    markDone();
    await waitFor(() => expect(screen.queryByText("Edit Task")).not.toBeInTheDocument());
    await waitFor(async () => expect((await ref!.tasks.task(ref!.id))!.done).toBe(true));
    expect(seen.some((t) => t.actionLabel === "Undo")).toBe(true);
    stop();
  });

  it("a refused completion keeps the sheet open and says so", async () => {
    resetToasts();
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    render(<NotesProvider userId="bigger-markdone-2"><Seed /></NotesProvider>);
    await openSheet();
    vi.spyOn(ref!.tasks, "completeTask").mockRejectedValue(new Error("offline"));
    markDone();
    await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    expect((await ref!.tasks.task(ref!.id))!.done).toBeFalsy();
    stop();
  });
});

// THE LOGGING STANDARD, rule 3 (2026-10-17): the new-step door reads a clock
// time out of the words AND writes it. Before this the door passed no
// readsReminder, so "3pm" stayed in the title here while TasksFlow read it.
describe("BiggerPictureFlow: a new step's words carry their reminder through to the task", () => {
  it("\"Call Nadia tomorrow 3pm\" lands as Call Nadia with a 3:00 PM reminder", async () => {
    resetToasts();
    localStorage.clear();
    render(<NotesProvider userId="bigger-newstep-reminder"><Seed /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add a Task"));
    const field = await screen.findByLabelText("Task");
    fireEvent.change(field, { target: { value: "Call Nadia tomorrow 3pm" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => {
      const made = (await ref!.tasks.listTasks()).find((t) => t.data.text === "Call Nadia");
      expect(made, "the title lost the words that were read").toBeDefined();
      expect(made!.data.reminder?.time).toBe("15:00");
    });
  });
});
