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
      await tasks.createTask("Book a checkup", { category: health });
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
    const row = screen.getByText("Bridge").closest(".area-card") as HTMLElement;
    expect(row).toBeTruthy();
    // One fact per count, the dot between them drawn by the stylesheet (§AM
    // F3), so no string carries one. Each count is a white number, whole.
    // The line shows every count, so it is the wrapping .conn-meta, never
    // the one-line .facts that cut "2 Projects" to "2 ..." (2026-09-26).
    const facts = Array.from(row.querySelectorAll(".conn-meta > .fact")).map((f) => f.textContent);
    expect(facts).toEqual(["2 Tasks", "1 Goal", "1 Project"]);
    expect(row.querySelectorAll(".conn-meta > .fact > b")).toHaveLength(3);
    expect(row.querySelector(".facts")).toBeNull();
    expect(row.querySelector(".conn-meta")?.textContent).not.toContain("·");
    // Money-kind is excluded outright, its task included (BrainPage's rule,
    // now enforced here): no row, no leak of its count into anything else.
    expect(screen.queryByText("Budget")).not.toBeInTheDocument();
  });

  // AMENDED 2026-10-05 (Dave, locked: "Clean rows, no pills anywhere"). Health
  // was a mini-app card with five section chips (Track, Train, Reports, Meds,
  // Privacy) inside it: pills in a card. It is the same plain card every area
  // is, first in the list, with its own counts; the five sections are the
  // doors on its own page.
  it("renders Health first, as a plain area card with its own counts and no section chips", async () => {
    render(<NotesProvider userId="areas-2"><Seeded /></NotesProvider>);
    await screen.findByText("Bridge", {}, { timeout: 3000 });
    const healthRow = screen.getByText("Health").closest(".area-card-health") as HTMLElement;
    expect(healthRow).toBeTruthy();
    expect(healthRow.classList.contains("area-card")).toBe(true);
    ["Track", "Train", "Reports", "Meds", "Privacy"].forEach((label) => expect(screen.queryByText(label)).toBeNull());
    expect(screen.queryByText("5 Sections")).toBeNull();
    expect(healthRow.querySelector(".health-chip, .health-sections")).toBeNull();
    // It draws what every area draws: one fact per count.
    expect([...healthRow.querySelectorAll(".conn-meta > .fact")].map((f) => f.textContent)).toEqual(["1 Task"]);
    // First in the list, ahead of the other areas.
    const names = [...document.querySelectorAll(".area-card .area-name")].map((n) => n.textContent);
    expect(names[0]).toBe("Health");
  });

  // The whole card is the one tap target; the card holds no control of its own.
  it("offers no control of its own: the card is the door", async () => {
    render(<NotesProvider userId="areas-5"><Seeded /></NotesProvider>);
    await screen.findByText("Bridge", {}, { timeout: 3000 });
    const healthRow = screen.getByText("Health").closest(".area-card-health") as HTMLElement;
    expect(healthRow.querySelectorAll("button")).toHaveLength(0);
    // The chevron is a glyph on the door, not a second control.
    expect(healthRow.querySelector(".chev")).not.toBeNull();
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

  it("an area with nothing filed shows its name alone, no fact line", async () => {
    function Empty() {
      const cats = useCategories();
      const [ready, setReady] = useState(false);
      useEffect(() => { void cats.create("Personal", "purple").then(() => setReady(true)); }, [cats]);
      return ready ? <AreasTab segments={<div>segments</div>} onOpenCategory={vi.fn()} /> : null;
    }
    render(<NotesProvider userId="areas-4"><Empty /></NotesProvider>);
    const row = (await screen.findByText("Personal", {}, { timeout: 3000 })).closest(".area-card") as HTMLElement;
    expect(row.querySelector(".conn-meta")).toBeNull();
  });

  // THE ADD IS THE HEAD'S (Dave 2026-10-05, locked; the perfect bar: the Areas head held a bare count and the page offered
  // no way to make an area).
  it("the Areas head carries one Add Area capsule, which makes an area through the same sheet Settings uses", async () => {
    render(<NotesProvider userId="areas-add"><Seeded /></NotesProvider>);
    await screen.findByText("Bridge", {}, { timeout: 3000 });
    const head = document.querySelector(".sh2")!;
    expect(head.querySelector(".t")!.textContent).toBe("Areas");
    expect(head.querySelector(".n"), "the bare count is gone").toBeNull();
    const add = head.querySelector("button.see-all.pill-action") as HTMLButtonElement;
    expect(add.textContent).toBe("Add Area");
    expect(document.querySelectorAll(".sh2 button").length, "one capsule, not two").toBe(1);
    fireEvent.click(add);
    expect(await screen.findByText("New Area")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/name/i), { target: { value: "Garden" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Garden", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText("New Area")).toBeNull();
  });
});
