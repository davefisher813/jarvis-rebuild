// @vitest-environment jsdom
// SPEC MOVED (2026-08-15, Smart Paste, addendum item 1): capture no longer
// previews and asks for a confirm tap. It saves INSTANTLY and offers
// post-action correction (refile chips, undo) on the receipt. These tests
// replaced the old preview-flow tests deliberately; the old behavior was not
// broken, it was retired.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useOptionalStrands, useTasks, useCategories } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";
import { recordCapture } from "../paste/captureLog";
import { TasksService } from "../tasks/TasksService";

// S4-Q22 (2026-09-04) needs to see the honest "Brain is full" toast text,
// which the earlier tests in this file never had to inspect. Same mock shape
// as ProfilePage.test.tsx: a captured fn standing in for the real module.
const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

beforeEach(() => localStorage.clear());

let strandsRef: ReturnType<typeof useOptionalStrands> | null = null;
let tasksRef: ReturnType<typeof useTasks> | null = null;
let catsRef: ReturnType<typeof useCategories> | null = null;
function CaptureStrands() {
  strandsRef = useOptionalStrands();
  tasksRef = useTasks();
  catsRef = useCategories();
  return null;
}

describe("QuickCapture (Smart Paste)", () => {
  it("saves instantly with no AI in the build and shows the receipt with refile chips", async () => {
    const onClose = vi.fn();
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    // Instant save: the receipt appears without any confirm step.
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("Renew the Domain")).toBeInTheDocument();
    expect(screen.getByText("Undo")).toBeInTheDocument();
    // The kind chips are present for post-action correction.
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("Event")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("asks the AI only for unconfident text and saves its answer instantly", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: '{"kind":"event","title":"Standup","start":"09:00"}' }),
      text: async () => "",
    })) as unknown as typeof fetch;
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: true, getToken: () => "tok", fetchImpl })} onClose={() => {}} />
      </NotesProvider>,
    );
    // "standup tomorrow": a date with no time and no imperative opener is
    // the deterministic layer's unconfident case, so the AI gets a say.
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "standup tomorrow" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a confident paste never calls the AI at all", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: "{}" }), text: async () => "" })) as unknown as typeof fetch;
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: true, getToken: () => "tok", fetchImpl })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the exact same paste within 7 days is flagged, with Save Anyway as the override", async () => {
    const ai = new AIService({ available: false });
    const { unmount } = render(
      <NotesProvider userId="u1">
        <QuickCapture ai={ai} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    unmount();

    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={ai} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText(/You captured this exact text/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save Anyway"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
});

// S4-Q22 (2026-09-04): selfFact.ts has always said "the receipt renders the
// category with chips to change it, same as every other capture" -- these
// prove that sentence is now true. No prior test file touched the fact
// lane's category chips at all.
describe("QuickCapture fact category chips (S4-Q22)", () => {
  beforeEach(() => { showToast.mockReset(); strandsRef = null; });

  it("offers the strand's six buckets, with the guessed one already active", async () => {
    render(
      <NotesProvider userId="u-fact-buckets">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    // selfFact.ts's own example sentence: SHAPES matches "I never...", and the
    // weekday bucket (routine) matches before any other, since "Sundays" hits
    // no energy words first.
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    expect(screen.getByText("Fact · Routine · From your paste")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "false");
    for (const label of ["Energy", "Work Style", "Writing", "People", "Values", "Routine"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("tapping a different bucket moves the fact", async () => {
    render(
      <NotesProvider userId="u-fact-move">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "Energy" }));
    await waitFor(() => expect(screen.getByText("Fact · Energy · From your paste")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "false");
  });

  it("a full bucket refuses honestly, and the chip stays where it was", async () => {
    render(
      <NotesProvider userId="u-fact-full">
        <CaptureStrands />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(strandsRef).toBeTruthy());
    await act(async () => {
      for (let i = 0; i < 12; i++) await strandsRef!.add("v " + i, "energy", "2026-01-01");
    });

    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "Energy" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "The Brain is full · Prune it in What JARVIS Knows" }));

    // The refusal moved nothing: the fact is still under Routine.
    expect(screen.getByText("Fact · Routine · From your paste")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "false");
  });

  // SHELL-F-02 (2026-09-05): the Fact chip on a saved task, with the Brain
  // full. This used to delete the task and say nothing. Now it says the
  // Brain is full, the receipt keeps saying Task, and the task is still in
  // Tasks.
  it("refiling a task to Fact when the Brain is full says so and keeps the task", async () => {
    showToast.mockClear();
    render(
      <NotesProvider userId="u-refile-full">
        <CaptureStrands />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(strandsRef).toBeTruthy());
    await act(async () => {
      // "call the plumber back" matches no fact shape, so it would file
      // under values: fill that bucket to its cap.
      for (let i = 0; i < 12; i++) await strandsRef!.add("v " + i, "values", "2026-01-01");
    });

    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "Task" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Fact" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "The Brain is full · Prune it in What JARVIS Knows" }));

    expect(screen.getByRole("radio", { name: "Task" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Fact" })).toHaveAttribute("aria-checked", "false");
    expect(await strandsRef!.list()).toHaveLength(12);
    expect(await tasksRef!.listTasks()).toHaveLength(1);
  });
});

// S6-Q35 (2026-09-04): "Recent Captures rows do nothing." A row is the
// receipt for something that already exists somewhere real; tapping it
// should open that thing, not sit there dead.
describe("QuickCapture: Recent Captures opens what it created (S6-Q35)", () => {
  it("tapping a row hands its kind and id to onOpen, then closes the sheet", async () => {
    recordCapture({ id: "old-task-1", kind: "task", title: "Renew the passport", ts: Date.now() - 60000 });
    const onClose = vi.fn();
    const onOpen = vi.fn();
    render(
      <NotesProvider userId="u-recent-open">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} onOpen={onOpen} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    expect(screen.getByText("Recent Captures")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Renew the passport"));
    expect(onOpen).toHaveBeenCalledWith("task", "old-task-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("with no onOpen wired, a row stays inert: no role, no crash on tap", async () => {
    recordCapture({ id: "old-note-1", kind: "note", title: "Ideas for the offsite", ts: Date.now() - 60000 });
    render(
      <NotesProvider userId="u-recent-inert">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "Water the plants" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    const row = screen.getByText("Ideas for the offsite").closest(".row")!;
    expect(row).not.toHaveAttribute("role");
    fireEvent.click(row); // must not throw
  });
});

// SHELL-F-16 (2026-09-05): the receipt's category chips were cats.slice(0, 4)
// for row width. Every template seeds six areas, so a capture that belonged
// in the fifth or sixth showed no active chip and could not be moved there at
// all, which also meant the learned-rules loop could never be taught them.
describe("QuickCapture receipt offers every area", () => {
  it("shows all six areas, and filing under the sixth lands on the record", async () => {
    render(
      <NotesProvider userId="u-six-areas">
        <CaptureStrands />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    const names = ["Work", "Family", "Health", "Money", "Friends", "Personal"];
    const ids: string[] = [];
    await act(async () => {
      for (const n of names) ids.push((await catsRef!.create(n, "blue"))!);
    });

    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    for (const n of names) expect(screen.getByText(n)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Personal"));
    await waitFor(async () => {
      const t = (await tasksRef!.listTasks())[0]!;
      expect(t.data.category).toBe(ids[5]);
    });
  });
});

// SHELL-F-24 (2026-09-05): Cancel and the scrim stayed live during
// "Saving...", and the save is a promise this sheet cannot abort. Tapping
// either one closed the sheet while the write went on to succeed: the task
// existed, with no receipt, no toast and no undo anywhere.
describe("QuickCapture while the save is in flight", () => {
  it("cannot be dismissed, so nothing lands without a receipt", async () => {
    let land: (id: string) => void = () => {};
    const create = vi.spyOn(TasksService.prototype, "createTask")
      .mockReturnValue(new Promise<string>((r) => { land = r; }));
    const onClose = vi.fn();
    render(
      <NotesProvider userId="u-inflight">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saving...")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { land("task-1"); });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    // And it closes normally again once there is something to close on.
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    create.mockRestore();
  });
});

// UP-ATH-18 (2026-09-06, option A): while a session is live the bar is
// standing next to the athlete, and "225 for 5" used to become a task called
// "225 For 5". The branch runs before any AI call and refuses everything it
// is not certain about.
import { writeLive, readLive, clearLive } from "../gym/liveSession";
import { todayISO } from "../ai/useAIContext";

describe("QuickCapture: a set goes to the live session", () => {
  const liveBench = () => writeLive({
    programId: "p", dayId: "d", dayName: "Push", date: todayISO(), startedAt: Date.now(), idx: 0,
    exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [] }],
  });

  beforeEach(() => { clearLive(); showToast.mockClear(); });

  it("logs the set on the exercise the athlete is on, and closes", async () => {
    liveBench();
    const onClose = vi.fn();
    render(
      <NotesProvider userId="qc-gym-1">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "225 for 5" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(readLive()!.exercises[0]!.sets).toHaveLength(1);
    expect(readLive()!.exercises[0]!.sets[0]).toMatchObject({ w: 225, r: 5 });
    expect(showToast.mock.calls[0]![0].message).toBe("Logged 225 lb × 5");
    expect(showToast.mock.calls[0]![0].actionLabel).toBe("Undo");
  });

  it("the Undo puts the strip back exactly as it was", async () => {
    liveBench();
    render(
      <NotesProvider userId="qc-gym-2">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "225 for 5" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(readLive()!.exercises[0]!.sets).toHaveLength(1));
    act(() => showToast.mock.calls[0]![0].onAction());
    expect(readLive()!.exercises[0]!.sets).toHaveLength(0);
  });

  it("text that is not a set still routes normally, even mid-session", async () => {
    liveBench();
    render(
      <NotesProvider userId="qc-gym-3">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(readLive()!.exercises[0]!.sets).toHaveLength(0);
  });

  it("with no session live the same words are a task, not a set", async () => {
    render(
      <NotesProvider userId="qc-gym-4">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "225 for 5" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
});
