// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import type { TasksService } from "./TasksService";
import TasksFlow from "./TasksFlow";

// Start, act, acknowledge, resume, through the real flow and the real service.
let svc: TasksService | null = null;
let taskId = "";

function Seeded({ steps }: { steps: string[] }) {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      const id = await tasks.createTask("Plan the trip", {});
      await tasks.setSteps(id!, steps.map((text) => ({ text, done: false })));
      svc = tasks; taskId = id!;
      setReady(true);
    })();
  }, [tasks, steps]);
  return ready ? <TasksFlow startId={taskId} startNonce={1} onStartConsumed={() => {}} /> : null;
}

const open = async (user: string, steps: string[]) => {
  render(<NotesProvider userId={user}><Seeded steps={steps} /></NotesProvider>);
  await screen.findByText("Mark It Done");
};

describe("TasksFlow: acknowledge a step, then resume", () => {
  it("marking the step done acknowledges it at once, saves it, and leaves the task open", async () => {
    await open("fb-flow-1", ["Pick dates", "Book flights"]);
    fireEvent.click(screen.getByText("Mark It Done"));
    expect(await screen.findByText("Step Done · 1 of 2 Complete")).toBeInTheDocument();
    const t = (await svc!.task(taskId))!;
    expect(t.steps!.map((s) => s.done)).toEqual([true, false]);
    expect(t.done).toBe(false);
    // The next move is already on screen: nothing waits behind the line.
    expect(await screen.findByText("Book flights")).toBeInTheDocument();
    expect(screen.getByText("1 of 2 Complete")).toBeInTheDocument();
  });

  it("Undo puts the exact list back, with no shame in the words", async () => {
    await open("fb-flow-2", ["Pick dates", "Book flights"]);
    fireEvent.click(screen.getByText("Mark It Done"));
    fireEvent.click(await screen.findByText("Undo"));
    expect(await screen.findByText("Undone · Back Where You Were")).toBeInTheDocument();
    await waitFor(async () => expect((await svc!.task(taskId))!.steps!.every((s) => !s.done)).toBe(true));
    expect(screen.getByText("Pick dates")).toBeInTheDocument();
  });

  it("the last step is a stopping point; the task itself is not closed for him", async () => {
    await open("fb-flow-3", ["Only step"]);
    fireEvent.click(screen.getByText("Mark It Done"));
    expect(await screen.findByText("Nothing Left Here")).toBeInTheDocument();
    expect((await svc!.task(taskId))!.done).toBe(false);
  });

  it("Worked on It is recorded apart from completion", async () => {
    await open("fb-flow-4", ["Pick dates", "Book flights"]);
    fireEvent.click(screen.getByText("Worked on It"));
    fireEvent.change(screen.getByLabelText("A note on what you worked on"), { target: { value: "read the options" } });
    fireEvent.click(screen.getByText("Log It"));
    expect(await screen.findByText("Logged · Worked on It")).toBeInTheDocument();
    const t = (await svc!.task(taskId))!;
    expect(t.worked).toHaveLength(1);
    expect(t.worked![0]!.note).toBe("read the options");
    expect(t.steps!.every((s) => !s.done)).toBe(true);
    expect(t.done).toBe(false);
  });

  it("Make this smaller puts the person's own smaller move in front, and it becomes the next move", async () => {
    await open("fb-flow-5", ["Book flights"]);
    fireEvent.click(screen.getByText("Make this smaller"));
    fireEvent.change(screen.getByLabelText("A smaller first move"), { target: { value: "Open the airline site" } });
    fireEvent.click(screen.getByText("Save Smaller Move"));
    await waitFor(async () => expect((await svc!.task(taskId))!.steps!.map((s) => s.text)).toEqual(["Open the airline site", "Book flights"]));
    await waitFor(() => expect(screen.queryByLabelText("A smaller first move")).toBeNull());
    expect(screen.getByText("Open the airline site")).toBeInTheDocument();
    expect(screen.getByText("0 of 2 Complete")).toBeInTheDocument();
  });
});
