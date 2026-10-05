// @vitest-environment jsdom
// 2026-10-04: three controls on Today that said more than their writes did.
//  - Reminders strip, Add: ignored Reminder Settings' Default Follow-up, which
//    the Reminders page's own New sheet honours.
//  - Missed Reminders, Ask Again: toasted "Asking Again" whatever the write did.
//  - Finish It (and Close on a finished project): celebrated whatever the
//    write did.
// Each is pressed through the real TodayFlow.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useProfile, useProjects, useCategories } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { setCategoryRegistry } from "../shared/categories";
import { TasksService } from "../tasks/TasksService";
import { ProjectsService } from "../projects/ProjectsService";
import { todayISO } from "../tasks/grouping";
import type { AIService } from "../ai/AIService";
import TodayFlow from "./TodayFlow";

type Toast = { message: string; actionLabel?: string; onAction?: () => void | Promise<void> };
const toasts: Toast[] = [];
const showToast = vi.fn((t: Toast) => { toasts.push(t); });
vi.mock("../shared/toast", () => ({ showToast: (t: Toast) => showToast(t), hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
vi.mock("../people/MessageDraftSheet", () => ({ default: () => null }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const messages = () => toasts.map((t) => t.message);
const FAILED = "Couldn't Save · Check Your Connection";

let ids = { task: "", project: "" };
type Seed = "none" | "missed-reminder" | "project" | "finished-project";
function Seeded({ seed, followUpOn = false }: { seed: Seed; followUpOn?: boolean }) {
  const tasks = useTasks();
  const projects = useProjects();
  const profile = useProfile();
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const cid = await cats.create("Bridge", "blue");
      if (followUpOn) await profile.save({ notify: { overdue: true, events: true, goals: true, defaultFollowUp: true } });
      if (seed === "missed-reminder") ids.task = (await tasks.createTask("Take Meds", { category: cid!, reminder: { time: "00:00" } }))!;
      if (seed === "finished-project") {
        ids.project = (await projects.create({ title: "Launch Site", status: "active", category: cid! }))!;
        ids.task = (await tasks.createTask("Ship the Last Page", { category: cid!, projectId: ids.project, done: true }))!;
      }
      if (seed === "project") {
        ids.project = (await projects.create({ title: "Launch Site", status: "active", category: cid! }))!;
        ids.task = (await tasks.createTask("Ship the Last Page", { category: cid!, projectId: ids.project, due: todayISO() }))!;
      }
      setReady(true);
    })();
  }, [tasks, projects, profile, cats, seed, followUpOn]);
  return ready ? <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} /> : null;
}
function mount(seed: Seed, followUpOn = false) {
  return render(
    <NotesProvider userId={"today-writes-" + Math.random().toString(36).slice(2)}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <Seeded seed={seed} followUpOn={followUpOn} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
}

beforeEach(() => { toasts.length = 0; showToast.mockClear(); localStorage.clear(); setCategoryRegistry([]); ids = { task: "", project: "" }; });
afterEach(() => { vi.restoreAllMocks(); });

describe("Today: Reminders strip Add honours Default Follow-up", () => {
  it("with the setting on, a new reminder starts at Once After 1 Hour", async () => {
    mount("none", true);
    fireEvent.click(await screen.findByText("Add a Reminder", {}, { timeout: 4000 }));
    expect((await screen.findByLabelText("Follow-up")).textContent).toContain("Once After 1 Hour");
  });

  it("with it off, it starts at None", async () => {
    mount("none", false);
    fireEvent.click(await screen.findByText("Add a Reminder", {}, { timeout: 4000 }));
    expect((await screen.findByLabelText("Follow-up")).textContent).toContain("None");
  });
});

describe("Today: Missed Reminders, Ask Again", () => {
  const openMissed = async () => {
    mount("missed-reminder");
    const row = await waitFor(() => {
      const r = document.querySelector(".rem-missed-row");
      if (!r) throw new Error("no missed row yet");
      return r;
    }, { timeout: 4000 });
    fireEvent.click(row);
    return screen.findByRole("button", { name: "Ask Again" });
  };

  it("a write that lands says Asking Again and moves the reminder", async () => {
    const ask = await openMissed();
    await act(async () => { fireEvent.click(ask); });
    await waitFor(() => expect(messages().some((m) => /^Asking Again at /.test(m))).toBe(true));
    expect(messages()).not.toContain(FAILED);
  });

  it("a write that throws says Couldn't Save and never Asking Again", async () => {
    vi.spyOn(TasksService.prototype, "snoozeReminder").mockRejectedValue(new Error("offline"));
    const ask = await openMissed();
    await act(async () => { fireEvent.click(ask); });
    await waitFor(() => expect(messages()).toContain(FAILED));
    expect(messages().some((m) => /Asking Again/.test(m))).toBe(false);
  });

  it("snoozeReminder answering false (the reminder is gone) is a failed save too", async () => {
    vi.spyOn(TasksService.prototype, "snoozeReminder").mockResolvedValue(false);
    const ask = await openMissed();
    await act(async () => { fireEvent.click(ask); });
    await waitFor(() => expect(messages()).toContain(FAILED));
    expect(messages().some((m) => /Asking Again/.test(m))).toBe(false);
  });
});

describe("Today: Finish It", () => {
  const finishOffer = async () => {
    mount("project");
    await waitFor(() => expect(screen.getAllByLabelText("Mark done").length).toBeGreaterThan(0), { timeout: 4000 });
    fireEvent.click(screen.getAllByLabelText("Mark done")[0]!);
    return waitFor(() => {
      const t = toasts.find((x) => x.actionLabel === "Finish It");
      if (!t) throw new Error("no Finish It offer yet");
      return t;
    }, { timeout: 4000 });
  };
  const press = async (offer: Toast) => { await act(async () => { await offer.onAction!(); }); };

  it("a write that lands celebrates", async () => {
    const offer = await finishOffer();
    await press(offer);
    expect(messages().at(-1)).toMatch(/Launch Site/);
    expect(messages()).not.toContain(FAILED);
  });

  it("a write that throws says Couldn't Save and the last word is not a celebration", async () => {
    vi.spyOn(ProjectsService.prototype, "update").mockRejectedValue(new Error("offline"));
    const offer = await finishOffer();
    await press(offer);
    expect(messages().at(-1)).toBe(FAILED);
  });

  it("update answering false (the project is gone) is a failed save, not a celebration", async () => {
    vi.spyOn(ProjectsService.prototype, "update").mockResolvedValue(false);
    const offer = await finishOffer();
    await press(offer);
    expect(messages().at(-1)).toBe(FAILED);
  });
});

// The Wrap Up card's Finish Project closes the same way: only a write that
// landed celebrates.
describe("Today: Wrap Up, Finish Project", () => {
  const finish = async () => {
    mount("finished-project");
    fireEvent.click(await screen.findByText("Wrap Up", {}, { timeout: 4000 }));
    await act(async () => { fireEvent.click(await screen.findByText("Finish Project")); });
  };

  it("a write that lands celebrates", async () => {
    await finish();
    await waitFor(() => expect(messages().at(-1)).toMatch(/Launch Site/));
  });

  it("a write that throws says Couldn't Save and never celebrates", async () => {
    vi.spyOn(ProjectsService.prototype, "update").mockRejectedValue(new Error("offline"));
    await finish();
    await waitFor(() => expect(messages()).toContain(FAILED));
    expect(messages().some((m) => /Launch Site/.test(m))).toBe(false);
  });

  it("update answering false (the project is gone) is a failed save", async () => {
    vi.spyOn(ProjectsService.prototype, "update").mockResolvedValue(false);
    await finish();
    await waitFor(() => expect(messages()).toContain(FAILED));
    expect(messages().some((m) => /Launch Site/.test(m))).toBe(false);
  });
});

// THE TOAST NAMES WHAT IT DID (Dave 2026-10-05, the review: "Marked Done" with no item name). Ticking a reminder says which one
// and its new state, in Title Case, with the Undo it always had.
describe("Today: ticking a reminder says which one", () => {
  it("toasts the reminder's own name and state, not a bare Marked Done", async () => {
    mount("missed-reminder");
    const row = await waitFor(() => {
      const r = document.querySelector(".rem-missed-row");
      if (!r) throw new Error("no missed row yet");
      return r;
    }, { timeout: 4000 });
    fireEvent.click(row);
    const tick = await screen.findByRole("button", { name: "Mark Take Meds done" });
    await act(async () => { fireEvent.click(tick); });
    await waitFor(() => expect(messages()).toContain("Take Meds Done"));
    expect(messages()).not.toContain("Marked Done");
    expect(toasts.find((t) => t.message === "Take Meds Done")?.actionLabel).toBe("Undo");
  });
});
