// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState } from "react";
import { NotesProvider, useProjects, useGoals, useTasks } from "../data/NotesProvider";
import LifeFlow from "./LifeFlow";
import { todayISO } from "../tasks/grouping";

// LIFE (ruled 2026-09-01): Tasks and Your Life, one tab, three zoom levels.
// Seeds first, mounts the flow after: the flow reads its lists on mount, and
// the test is about the page, not about live repaints.
function Seeded({ segment }: { segment?: "tasks" | "projects" | "goals" }) {
  const p = useProjects(); const g = useGoals(); const t = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const goalId = await g.create({ title: "Build a six-month runway", state: "on_track", tags: ["money"] });
      await p.create({ title: "Kitchen remodel", status: "active", goalId: goalId ?? undefined, category: "money" });
      await t.createTask("Pay the deposit", { category: "money", due: todayISO() });
      setReady(true);
    })();
  }, [p, g, t]);
  return ready ? <LifeFlow segment={segment} /> : null;
}

describe("LifeFlow", () => {
  it("lands on Tasks under a head called Life, with the three segments", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    expect(await screen.findByText("Pay the deposit", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(document.querySelector(".pagehead-title")).toHaveTextContent("Life");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Tasks", "Projects", "Goals"]);
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "true");
  });

  it("Projects groups projects under their goal as a head with the pie row; Goals shows goals only", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    await screen.findByText("Pay the deposit", {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    // The one ask names the project too (it has no next move), so scope to the row.
    await screen.findByText("Add Project");
    const row = screen.getAllByText("Kitchen remodel").map((e) => e.closest(".task-row")).find(Boolean) as HTMLElement;
    expect(row).toBeTruthy();
    // Goals and Projects (2026-09-02): the goal is written once, as the head
    // over its projects, full title with the mark; the row carries the
    // progress pie where a task's check sits and no goal line of its own.
    const head = screen.getByText("Build a six-month runway");
    expect(head.closest(".sh2.gh-goal")!.querySelector(".gh-mark .r-gm")).toBeTruthy();
    expect(row.querySelector(".pp")).toBeTruthy();
    expect(row.querySelector(".r-is-goal")).toBeNull();
    expect(screen.getByText("Add Project")).toBeInTheDocument();
    expect(screen.queryByText("Add Goal")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Goals" }));
    const goal = await screen.findByText("Build a six-month runway");
    expect(goal.closest(".task-row.goal-row-ruled")).toBeTruthy();
    expect(document.querySelector(".task-row .pp")).toBeNull();
    expect(screen.getByText("Add Goal")).toBeInTheDocument();
    expect(screen.queryByText("Add Project")).toBeNull();
  });

  it("a deep link picks its segment over the session memory", async () => {
    render(<NotesProvider userId="u1"><Seeded segment="goals" /></NotesProvider>);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Goals" })).toHaveAttribute("aria-selected", "true"));
  });
});

// THE ONE ASK AS A NOTICE ROW (Goals and Projects, 2026-09-02). On the Life
// tab the stalled-project ask sits in the list with the notice-row anatomy
// (tile, name, one line of why, one pill) instead of the promo card.
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: true, complete: async () => "Call the contractor" }) }));

describe("LifeFlow, the one ask", () => {
  it("renders the stalled project as a notice row with a First Step pill, not a promo card", async () => {
    render(<NotesProvider userId="u2"><Seeded segment="projects" /></NotesProvider>);
    await screen.findByText("Add Project", {}, { timeout: 3000 });
    const pill = await screen.findByRole("button", { name: "First Step" });
    expect(pill.closest(".one-ask-row .stream-card .notice-card")).toBeTruthy();
    expect(document.querySelector(".promo-card")).toBeNull();
    expect(screen.getByText("Nothing is moving here")).toBeInTheDocument();
  });
});

// LIFE-F-07 (2026-09-05): BiggerPictureFlow read openId and openGoalId once,
// in useState initialisers, and LifeFlow only remounts it when the LENS
// changes. So searching a project while already on Life > Projects, or a goal
// on Goals, closed the search onto the list it was already showing. The same
// tap worked from any other tab, because that remounts the flow.
function DeepLinked({ lens }: { lens: "projects" | "goals" }) {
  const p = useProjects(); const g = useGoals();
  const [id, setId] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  useEffect(() => {
    void (async () => {
      const goalId = await g.create({ title: "Build a six-month runway", state: "on_track" });
      const projectId = await p.create({ title: "Kitchen remodel", status: "active", goalId: goalId ?? undefined });
      setId((lens === "projects" ? projectId : goalId) ?? undefined);
    })();
  }, [p, g, lens]);
  return id ? (
    <>
      <button onClick={() => setOpen((o) => ({ value: id, nonce: o.nonce + 1 }))}>Link It</button>
      <LifeFlow
        segment={lens}
        projectOpenId={lens === "projects" ? open.value : undefined}
        projectNonce={open.nonce}
        goalOpenId={lens === "goals" ? open.value : undefined}
        goalNonce={open.nonce}
      />
    </>
  ) : null;
}

describe("a deep link into the lens you are already on (LIFE-F-07)", () => {
  it("opens a project detail that arrives after the lens is mounted", async () => {
    render(<NotesProvider userId="deep-life-1"><DeepLinked lens="projects" /></NotesProvider>);
    await screen.findAllByText("Kitchen remodel", {}, { timeout: 3000 });
    // The list, not the detail: the detail carries its own Back.
    expect(screen.queryByLabelText("Back")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByLabelText("Back")).toBeInTheDocument());
  });

  it("does the same for a goal on the Goals lens", async () => {
    render(<NotesProvider userId="deep-life-2"><DeepLinked lens="goals" /></NotesProvider>);
    await screen.findAllByText("Build a six-month runway", {}, { timeout: 3000 });
    expect(screen.queryByLabelText("Back")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByLabelText("Back")).toBeInTheDocument());
  });
});
