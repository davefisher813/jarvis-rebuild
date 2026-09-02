// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
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

  it("Projects shows every project under its category with the goal's short name; Goals shows goals only", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    await screen.findByText("Pay the deposit", {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    expect(await screen.findByText("Kitchen remodel")).toBeInTheDocument();
    // the lineage line: the goal by its short name, with the mark
    const line = screen.getByText("Six-month runway");
    expect(line.closest(".r-is-goal")!.querySelector(".r-gm")).toBeTruthy();
    expect(screen.queryByText("Build a six-month runway")).toBeNull();
    expect(screen.getByText("Add Project")).toBeInTheDocument();
    expect(screen.queryByText("Add Goal")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Goals" }));
    expect(await screen.findByText("Build a six-month runway")).toBeInTheDocument();
    expect(screen.queryByText("Kitchen remodel")).toBeNull();
    expect(screen.getByText("Add Goal")).toBeInTheDocument();
    expect(screen.queryByText("Add Project")).toBeNull();
  });

  it("a deep link picks its segment over the session memory", async () => {
    render(<NotesProvider userId="u1"><Seeded segment="goals" /></NotesProvider>);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Goals" })).toHaveAttribute("aria-selected", "true"));
  });
});
