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
