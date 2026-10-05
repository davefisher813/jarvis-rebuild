// @vitest-environment jsdom
// 2026-10-04: "Finish It", the toast action offered when the last task of a
// project is ticked, celebrated whatever its write did. A write that threw
// had its "Couldn't Save" overwritten by "project finished", and update()
// answering false (the project deleted on another device inside the toast's
// five seconds) celebrated a project that does not exist. This renders the
// real flow and presses the real action the way ToastHost does.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useProjects, useCategories } from "../data/NotesProvider";
import { ProjectsService } from "../projects/ProjectsService";
import TasksFlow from "./TasksFlow";
import { todayISO } from "./grouping";
import { subscribeToast, resetToasts, hideToast } from "../shared/toast";

vi.mock("../people/MessageDraftSheet", () => ({ default: () => null }));

let projectsSvc: ProjectsService | null = null;
let projectId = "";
function Seeded() {
  const tasks = useTasks();
  const projects = useProjects();
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const cid = await cats.create("Bridge", "blue");
      projectsSvc = projects;
      projectId = (await projects.create({ title: "Launch Site", status: "active", category: cid! }))!;
      await tasks.createTask("Ship the Last Page", { category: cid!, projectId, due: todayISO() });
      setReady(true);
    })();
  }, [tasks, projects, cats]);
  return ready ? <TasksFlow /> : null;
}

type Toast = { message: string; actionLabel?: string; onAction?: () => void | Promise<void> };
let seen: string[] = [];
let current: Toast | null = null;
let stop = () => {};
beforeEach(() => {
  resetToasts();
  seen = []; current = null;
  stop = subscribeToast((t) => { current = t as Toast | null; if (t) seen.push(t.message); });
});
afterEach(() => { stop(); resetToasts(); vi.restoreAllMocks(); });

// Tick the project's only task, wait for the Finish It offer, then press it
// the way ToastHost does: run the action, then hide the toast.
async function pressFinishIt() {
  render(<NotesProvider userId={"finish-it-" + Math.random().toString(36).slice(2)}><Seeded /></NotesProvider>);
  await waitFor(() => expect(screen.getAllByText("Ship the Last Page").length).toBeGreaterThan(0), { timeout: 4000 });
  fireEvent.click(screen.getAllByLabelText("Mark done")[0]!);
  await waitFor(() => expect(current?.actionLabel).toBe("Finish It"), { timeout: 4000 });
  const offer = current!;
  let run: void | Promise<void>;
  await act(async () => { run = offer.onAction!(); hideToast(); await run; });
}

describe("TasksFlow: Finish It", () => {
  it("a write that lands finishes the project and celebrates", async () => {
    await pressFinishIt();
    await waitFor(async () => expect((await projectsSvc!.get(projectId))?.data.status).toBe("done"), { timeout: 4000 });
    expect(seen.at(-1)).toMatch(/Launch Site/);
  });

  it("a write that throws says Couldn't Save and never celebrates", async () => {
    vi.spyOn(ProjectsService.prototype, "update").mockRejectedValue(new Error("offline"));
    await pressFinishIt();
    await waitFor(() => expect(seen).toContain("Couldn't Save · Check Your Connection"));
    expect(seen.at(-1)).toBe("Couldn't Save · Check Your Connection");
    expect(seen.some((m) => /Launch Site/.test(m) && m !== seen[0])).toBe(false);
    expect((await projectsSvc!.get(projectId))?.data.status).toBe("active");
  });

  it("update answering false (the project is gone) is a failed save, not a celebration", async () => {
    vi.spyOn(ProjectsService.prototype, "update").mockResolvedValue(false);
    await pressFinishIt();
    await waitFor(() => expect(seen).toContain("Couldn't Save · Check Your Connection"));
    expect(seen.at(-1)).toBe("Couldn't Save · Check Your Connection");
  });
});
