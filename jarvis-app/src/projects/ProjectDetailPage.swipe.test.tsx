// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProjectDetailPage, { type ProjectStep } from "./ProjectDetailPage";
import GoalDetailPage from "../bigger/GoalDetailPage";
import { setCategoryRegistry } from "../shared/categories";
import type { Project } from "./types";

// SWIPE IS THE STANDARD (Dave 2026-10-13). A project's steps and a goal's milestones are task lists, and a task list swipes:
// right completes, left deletes, tap opens.
afterEach(cleanup);
setCategoryRegistry([]);

const project: Project = { id: "p1", data: { title: "Kitchen Remodel", status: "active" } } as Project;
const step = (id: string, text: string, done = false): ProjectStep => ({ id, text, done });

describe("a project's steps swipe", () => {
  it("an open step has the Done rail and Delete; a tap opens it and the Delete button deletes it", () => {
    const onOpenStep = vi.fn(); const onDeleteStep = vi.fn(); const onToggleStep = vi.fn();
    const { container } = render(<ProjectDetailPage project={project} onBack={() => {}} onEdit={() => {}} steps={[step("a", "Order tile")]} today="2026-10-05"
      onOpenStep={onOpenStep} onDeleteStep={onDeleteStep} onToggleStep={onToggleStep} />);
    expect(container.querySelector(".proj-step")!.closest(".task-swipe")!.querySelector(".task-done-rail")).toHaveTextContent("Done");
    fireEvent.click(container.querySelector(".proj-step") as HTMLElement);
    expect(onOpenStep).toHaveBeenCalledWith("a");
    fireEvent.click(screen.getByRole("button", { name: "Delete Order Tile" }));
    expect(onDeleteStep).toHaveBeenCalledWith("a");
    // The ring is still its own control.
    fireEvent.click(container.querySelector(".task-check-tap") as HTMLElement);
    expect(onToggleStep).toHaveBeenCalledWith("a");
    expect(onOpenStep).toHaveBeenCalledTimes(1);
  });
  it("a finished step can be deleted by swipe but has no Done rail", () => {
    const { container } = render(<ProjectDetailPage project={project} onBack={() => {}} onEdit={() => {}} steps={[step("a", "Order tile", true)]} today="2026-10-05"
      onOpenStep={() => {}} onDeleteStep={() => {}} onToggleStep={() => {}} />);
    fireEvent.click(screen.getByText(/1 finished/i));
    const row = container.querySelector(".proj-step.completed")!;
    expect(row.closest(".task-swipe")!.querySelector(".task-done-rail")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Order Tile" })).toBeInTheDocument();
  });
});

describe("a goal's milestones swipe", () => {
  const goal = { id: "g", data: { title: "Open the Gym", state: "on_track" as const, measure: { kind: "milestones" as const, items: [{ id: "m1", text: "Sign the lease" }, { id: "m2", text: "Buy racks", done: "2026-10-01" }] } } };
  it("an open milestone swipes right to done and left to delete; a finished one only deletes", () => {
    const onMilestoneDone = vi.fn(); const onDeleteMilestone = vi.fn();
    const { container } = render(<GoalDetailPage goal={goal} reach={{ filedIds: [], taggedIds: [], openTagged: 0, progress: null }} projects={[]} nextActionTextOf={() => null}
      onBack={() => {}} onEdit={() => {}} onOpenProject={() => {}} onAddProject={() => {}}
      onMilestoneDone={onMilestoneDone} onDeleteMilestone={onDeleteMilestone} />);
    const rows = [...container.querySelectorAll(".ms-row")].map((r) => r.closest(".task-swipe")!);
    expect(rows.length).toBe(3); // Next Milestone, then the two in the list
    expect(rows[1]!.querySelector(".task-done-rail")).not.toBeNull();
    expect(rows[2]!.querySelector(".task-done-rail"), "a finished milestone has nothing to complete").toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete Buy Racks" })[0]!);
    expect(onDeleteMilestone).toHaveBeenCalledWith("m2");
  });
});
