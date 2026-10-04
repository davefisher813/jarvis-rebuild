// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { subscribeToast, resetToasts } from "../shared/toast";
import BiggerPicturePage from "./BiggerPicturePage";
import type { ProjectRow } from "./progress";
import type { GoalReach } from "./reach";

// THE TWO LENSES (§AK and §AM, 2026-09-26). The unlensed single frame these
// tests used to render is gone: Life always mounts this page as one of its
// segments, and its rows stacked up to five greys under one title.
afterEach(cleanup);

const row = (over: Partial<ProjectRow["project"]["data"]> = {}): ProjectRow => ({
  project: { id: "p1", data: { title: "Remodel Bridge Website", status: "active", due: "2026-09-06", ...over } },
  progress: { done: 3, total: 8, pct: 38 },
  stalled: false,
  lastAt: null,
});

const reach = (): GoalReach => ({ progress: null } as unknown as GoalReach);

// THE PROJECTS LENS, BOTH SHAPES (§AK, 2026-09-26): an unstarted project's
// row and card carry its title and nothing under it, never "No tasks yet".
describe("BiggerPicturePage Projects lens, a project with no tasks", () => {
  it("prints no placeholder on the card or on the ruled row", () => {
    const r: ProjectRow = { ...row({ category: "work" }), progress: null };
    const { container } = render(
      <BiggerPicturePage
        lens="projects"
        segments={<div />}
        goals={[]}
        reachOfGoal={reach}
        projectRows={[r]}
        sections={[{ id: "work", name: "Work", color: "blue" }]}
        onAddGoal={() => {}}
        onOpenGoal={() => {}}
        onAddProject={() => {}}
        onOpenProject={() => {}}
      />,
    );
    expect(container.textContent).toContain("Remodel Bridge Website");
    expect(container.textContent).not.toMatch(/No tasks yet/);
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    expect(container.querySelector(".proj-row-ruled")).toBeTruthy();
    expect(container.textContent).not.toMatch(/No tasks yet/);
    // Not even an empty meter line holding its margin under the title.
    expect(container.querySelector(".proj-row-ruled .goal-meter")).toBeNull();
  });
});

// THE GOALS LENS LOGBOOK (§AM F5, 2026-09-26): a finished goal's line is its
// finish date, drawn as a neutral date, with nothing in it bolded.
describe("BiggerPicturePage Goals lens, a finished goal", () => {
  it("draws the finish date as a .fact.date", () => {
    const g = { id: "g1", data: { title: "Run a Half", state: "achieved" as const, achievedOn: "2026-09-12", tags: ["health"] } };
    const { container, getByText } = render(
      <BiggerPicturePage
        lens="goals"
        segments={<div />}
        goals={[g]}
        reachOfGoal={reach}
        projectRows={[]}
        sections={[{ id: "health", name: "Health", color: "green" }]}
        statusOf={() => ({ text: "Done", tone: "good" })}
        onAddGoal={() => {}}
        onOpenGoal={() => {}}
        onAddProject={() => {}}
        onOpenProject={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    fireEvent.click(getByText(/1 Done Goal/i).closest("button")!);
    const meter = container.querySelector(".goal-row-ruled .goal-meter") as HTMLElement;
    expect(meter.querySelector(".fact.date")?.textContent).toBe("Finished September 12");
    expect(meter.querySelector("b")).toBeNull();
  });
});

// DAVE'S AUDIT, 2026-10-04: "does Show Everything actually do anything?" With a status or an area narrowing the list it
// resets both and says so; with nothing narrowing it, the row is a status line and not a button that does nothing.
describe("BiggerPicturePage Goals Options sheet", () => {
  const goals = [
    { id: "g1", data: { title: "Run Three Times a Week", state: "active" as const, tags: ["health"] } },
    { id: "g2", data: { title: "Run a Half", state: "achieved" as const, achievedOn: "2026-09-12", tags: ["health"] } },
  ];
  const page = () => render(
    <BiggerPicturePage lens="goals" segments={<div />} goals={goals} reachOfGoal={reach} projectRows={[]}
      sections={[{ id: "health", name: "Health", color: "green" }]}
      onAddGoal={() => {}} onOpenGoal={() => {}} onAddProject={() => {}} onOpenProject={() => {}} />,
  );
  const toasts: string[] = [];
  let stop = () => {};
  beforeEach(() => { toasts.length = 0; stop = subscribeToast((t) => { if (t) toasts.push(t.message); }); });
  afterEach(() => { stop(); resetToasts(); });

  it("narrowed to Active, Show Everything names what it was showing, widens the list, confirms, and closes", () => {
    const { container } = page();
    expect(container.textContent).not.toContain("Run a Half");
    fireEvent.click(screen.getByLabelText("Goals Options"));
    expect(document.querySelector(".opt-val")?.textContent).toBe("Active");
    fireEvent.click(screen.getByText("Show Everything"));
    expect(document.querySelector(".opt-bar")).toBeNull();
    expect(container.textContent).toContain("Run a Half");
    expect(toasts).toContain("Showing Everything");
  });

  it("already showing everything: no button that does nothing, a status line that says so", () => {
    const { container } = page();
    fireEvent.click(screen.getByLabelText("Goals Options"));
    fireEvent.click(screen.getByText("Show Everything"));
    fireEvent.click(screen.getByLabelText("Goals Options"));
    const row = screen.getByText("Showing Everything").closest(".row")!;
    expect(row.getAttribute("role")).toBeNull();
    expect(row.querySelector(".chev")).toBeNull();
    expect(screen.queryByText("Show Everything")).toBeNull();
    // Done still dismisses it.
    fireEvent.click(document.querySelector(".opt-done")!);
    expect(document.querySelector(".opt-bar")).toBeNull();
    expect(container.textContent).toContain("Run a Half");
  });
});
