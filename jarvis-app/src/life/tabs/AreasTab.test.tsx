// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState } from "react";
import { NotesProvider, useCategories, useTasks, useProjects, useGoals } from "../../data/NotesProvider";
import AreasTab from "./AreasTab";

// AREAS TAB (LIFE_AREAS_TAB_HANDOFF, 2026-09-16). Health is seeded with an
// explicit kind so the test does not depend on suggestKind's name guessing;
// Bridge is left with no kind (plain, the common case for a freshly made
// area) and Budget is explicitly money-kind, the one area type this tab
// never shows a row for (BrainPage's old "Your Areas" rule, moved here).
function Seeded() {
  const cats = useCategories();
  const tasks = useTasks();
  const projects = useProjects();
  const goals = useGoals();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const health = (await cats.create("Health", "green"))!;
      await cats.update(health, { kind: "health" });
      const bridge = (await cats.create("Bridge", "blue"))!;
      const budget = (await cats.create("Budget", "yellow"))!;
      await cats.update(budget, { kind: "money" });

      await tasks.createTask("Book the venue", { category: bridge });
      await tasks.createTask("Order jerseys", { category: bridge });
      await projects.create({ title: "Spring Fundraiser", category: bridge, status: "active" });
      await goals.create({ title: "Raise $10k", state: "on_track", tags: [bridge] });
      await tasks.createTask("Log a lift", { category: budget }); // never counted: money is excluded whole

      setReady(true);
    })();
  }, [cats, tasks, projects, goals]);
  return ready ? <AreasTab segments={<div>segments</div>} onOpenCategory={vi.fn()} /> : null;
}

describe("AreasTab", () => {
  it("loads and shows every non-money area, with accurate task/goal/project counts", async () => {
    render(<NotesProvider userId="areas-1"><Seeded /></NotesProvider>);
    expect(await screen.findByText("Bridge", {}, { timeout: 3000 })).toBeInTheDocument();
    const row = screen.getByText("Bridge").closest(".area-row") as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.querySelector(".area-stats")?.textContent).toBe("2 tasks1 goal1 project");
    // Money-kind is excluded outright, its task included (BrainPage's rule,
    // now enforced here): no row, no leak of its count into anything else.
    expect(screen.queryByText("Budget")).not.toBeInTheDocument();
  });

  it("renders Health as the four-section mini-app card, not a standard row", async () => {
    render(<NotesProvider userId="areas-2"><Seeded /></NotesProvider>);
    await screen.findByText("Bridge", {}, { timeout: 3000 });
    const healthRow = screen.getByText("Health").closest(".health-mini-app") as HTMLElement;
    expect(healthRow).toBeTruthy();
    // Hardcoded, per the handoff -- no query backs these, they're a preview.
    ["Log It", "Reports", "Meds", "Privacy"].forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
    // It never wears the standard area's stats line.
    expect(healthRow.querySelector(".area-stats")).toBeNull();
  });

  it("tapping an area, and tapping Health, both call onOpenCategory with that area's id", async () => {
    function SeededWithSpy({ onOpenCategory }: { onOpenCategory: (id: string) => void }) {
      const cats = useCategories();
      const [ready, setReady] = useState(false);
      const [ids, setIds] = useState<{ health: string; bridge: string } | null>(null);
      useEffect(() => {
        void (async () => {
          const health = (await cats.create("Health", "green"))!;
          await cats.update(health, { kind: "health" });
          const bridge = (await cats.create("Bridge", "blue"))!;
          setIds({ health, bridge });
          setReady(true);
        })();
      }, [cats]);
      return ready && ids ? <AreasTab segments={<div>segments</div>} onOpenCategory={onOpenCategory} /> : null;
    }
    const onOpenCategory = vi.fn();
    render(<NotesProvider userId="areas-3"><SeededWithSpy onOpenCategory={onOpenCategory} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Bridge", {}, { timeout: 3000 }));
    expect(onOpenCategory).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Health"));
    expect(onOpenCategory).toHaveBeenCalledTimes(2);
    // Both calls named a real category id, not "health"/"bridge" literals.
    expect(onOpenCategory.mock.calls[0]![0]).not.toBe("bridge");
    expect(onOpenCategory.mock.calls[1]![0]).not.toBe("health");
  });

  it("an area with nothing filed shows its name alone, no stats line", async () => {
    function Empty() {
      const cats = useCategories();
      const [ready, setReady] = useState(false);
      useEffect(() => { void cats.create("Personal", "purple").then(() => setReady(true)); }, [cats]);
      return ready ? <AreasTab segments={<div>segments</div>} onOpenCategory={vi.fn()} /> : null;
    }
    render(<NotesProvider userId="areas-4"><Empty /></NotesProvider>);
    const row = (await screen.findByText("Personal", {}, { timeout: 3000 })).closest(".area-row") as HTMLElement;
    expect(row.querySelector(".area-stats")).toBeNull();
  });
});
