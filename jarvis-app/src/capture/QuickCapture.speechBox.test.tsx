// @vitest-environment jsdom
// THE SPEECH BOX, IN THE BOX (2026-10-31). A question goes to Chat and is never saved; a workout set goes to training and is
// never a Note; a close call asks with two big buttons. Each is the tap that confirms (voice never saves on its own).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import type React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useNotes, useTasks, useOptionalGym } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";
import { QUICK_LOG_DAY } from "./logSpokenSet";

const toasts = vi.hoisted(() => [] as { message: string; actionLabel?: string; onAction?: () => void }[]);
vi.mock("../shared/toast", () => ({ showToast: (t: { message: string; actionLabel?: string; onAction?: () => void }) => { toasts.push(t); } }));

const refs: { notes: ReturnType<typeof useNotes> | null; tasks: ReturnType<typeof useTasks> | null; gym: ReturnType<typeof useOptionalGym> } = { notes: null, tasks: null, gym: null };
function Grab({ children }: { children: React.ReactNode }) {
  refs.notes = useNotes();
  refs.tasks = useTasks();
  refs.gym = useOptionalGym();
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok ? <>{children}</> : null;
}
const mount = (userId: string, props: Partial<React.ComponentProps<typeof QuickCapture>> = {}, ai = new AIService({ available: false })) => render(
  <NotesProvider userId={userId}><Grab><QuickCapture ai={ai} onClose={() => {}} {...props} /></Grab></NotesProvider>,
);
const type = async (line: string) => fireEvent.change(await screen.findByLabelText("Paste or Type"), { target: { value: line } });

beforeEach(() => { localStorage.clear(); toasts.length = 0; refs.notes = null; refs.tasks = null; refs.gym = null; });

describe("Speech box: a question is asked, never saved", () => {
  it("the button says Ask JARVIS, the tap hands the words to Chat, and nothing is written", async () => {
    const onAsk = vi.fn();
    mount("u-sb-q", { onAsk });
    await type("What is on my schedule tomorrow?");
    await waitFor(() => expect(screen.getByText("Question for JARVIS")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Ask JARVIS"));
    expect(onAsk).toHaveBeenCalledWith("What is on my schedule tomorrow?");
    expect(await refs.notes!.listNotes()).toHaveLength(0);
    expect(await refs.tasks!.listTasks()).toHaveLength(0);
  });
});

describe("Speech box: a set is logged into training, never a Note", () => {
  it("'Log a set. Deadlift, 405 pounds, 5 reps.' with no session open lands in today's Quick Log, with Undo", async () => {
    mount("u-sb-set");
    await type("Log a set. Deadlift, 405 pounds, 5 reps.");
    await waitFor(() => expect(screen.getByText("Log Set")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Log Set"));
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts.map((t) => t.message).join(" | ")).toBe("Logged Deadlift 405 lb × 5 to Quick Log");
    const ws = await refs.gym!.listWorkouts();
    expect(ws).toHaveLength(1);
    expect(ws[0]!.data).toMatchObject({ dayId: QUICK_LOG_DAY, dayName: "Quick Log" });
    expect(ws[0]!.data.exercises[0]).toMatchObject({ name: "Deadlift", kind: "weight_reps", unit: "lb" });
    expect(ws[0]!.data.exercises[0]!.sets[0]).toMatchObject({ w: 405, r: 5, state: "reported" });
    expect(await refs.notes!.listNotes()).toHaveLength(0);
    // Undo takes it back off.
    toasts.find((t) => t.actionLabel === "Undo")!.onAction!();
    await waitFor(async () => expect(await refs.gym!.listWorkouts()).toHaveLength(0));
  });

  it("a second set the same day joins the same Quick Log, on the same lift", async () => {
    mount("u-sb-set2");
    await type("bench press 225 for 8");
    fireEvent.click(await screen.findByText("Log Set"));
    await waitFor(async () => expect(await refs.gym!.listWorkouts()).toHaveLength(1));
    await type("3 sets of 8 bench press at 225 pounds");
    fireEvent.click(await screen.findByText("Log Set"));
    await waitFor(async () => {
      const ws = await refs.gym!.listWorkouts();
      expect(ws).toHaveLength(1);
      expect(ws[0]!.data.exercises).toHaveLength(1);
      expect(ws[0]!.data.exercises[0]!.sets).toHaveLength(4);
    });
  });
});

describe("Speech box: a close call asks with two big buttons", () => {
  it("nothing is saved until one is tapped, and the tapped one is what lands", async () => {
    const ai = new AIService({ available: false });
    Object.defineProperty(ai, "available", { value: true });
    ai.complete = async () => JSON.stringify({ kind: "note", title: "Summer Roster", confidence: "low", alternative: "task" });
    mount("u-sb-ask", {}, ai);
    await type("Marco and the summer roster");
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Is This a Note or a Task?")).toBeInTheDocument());
    expect(await refs.notes!.listNotes()).toHaveLength(0);
    expect(await refs.tasks!.listTasks()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Task" }));
    await waitFor(async () => expect(await refs.tasks!.listTasks()).toHaveLength(1));
    expect(await refs.notes!.listNotes()).toHaveLength(0);
  });
});
