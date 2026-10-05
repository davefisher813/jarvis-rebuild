// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// THE SHIP-BLOCKER REVIEW (Dave 2026-10-05, "everything should look PERFECT"), the project page's two defects.
vi.mock("../data/NotesProvider", async (orig) => {
  const real = await orig<typeof import("../data/NotesProvider")>();
  return {
    ...real,
    useOptionalDecisions: () => ({
      getByLink: async () => ({ id: "d1", data: { decision: "student template ships first", why: "Northlake gives 60 warm leads", createdAt: "2026-10-05T12:00:00Z" } }),
    }),
  };
});
import ProjectDetailPage, { type ProjectStep } from "./ProjectDetailPage";
import { setCategoryRegistry } from "../shared/categories";
import type { Project } from "./types";

afterEach(cleanup);
setCategoryRegistry([]);

const project: Project = { id: "p1", data: { title: "Rebuild Calder App", status: "active" } } as Project;
const step = (id: string, text: string, done = false): ProjectStep => ({ id, text, done });
const draw = (steps: ProjectStep[], extra: Partial<Parameters<typeof ProjectDetailPage>[0]> = {}) => render(
  <ProjectDetailPage project={project} onBack={() => {}} onEdit={() => {}} steps={steps} today="2026-10-05" {...extra} />,
);

describe("the decision card's title", () => {
  it("is Title Case, not lowercase after the first word", async () => {
    const { container } = draw([step("a", "Order tile")]);
    await waitFor(() => expect(container.querySelector(".promo-title")).not.toBeNull());
    expect(container.querySelector(".promo-title")!.textContent).toBe("Student Template Ships First");
  });
});

describe("the Finished disclosure", () => {
  it("lives in the Tasks section head, never as a chip under the card", () => {
    const { container } = draw([step("a", "Order tile"), step("b", "Hire plumber", true)], { onAddStep: () => {} });
    const toggle = screen.getByRole("button", { name: "1 Finished" });
    const head = toggle.closest(".sh2")!;
    expect(head, "inside a section head").not.toBeNull();
    expect(head.querySelector(".t")!.textContent).toBe("Tasks");
    expect(toggle).toHaveClass("see-all", "pill-action");
    // The capsule keeps the far right: the quiet text comes ahead of it in the head.
    const kids = [...head.querySelectorAll("button")];
    expect(kids.map((k) => k.textContent)).toEqual(["1 Finished", "Add a Task"]);
    // And nothing floats under the card as an orphan chip.
    expect(container.querySelector(".proj-done-fold")).toBeNull();
    expect(container.querySelectorAll(".sh2 .pill-action").length, "a head holds one or two capsules").toBeLessThanOrEqual(2);
  });

  it("opens the finished list under the card and reads Hide Finished from the same place", () => {
    const { container } = draw([step("a", "Order tile"), step("b", "Hire plumber", true)], { onAddStep: () => {} });
    fireEvent.click(screen.getByRole("button", { name: "1 Finished" }));
    const toggle = screen.getByRole("button", { name: "Hide Finished" });
    expect(toggle.closest(".sh2")).not.toBeNull();
    expect(container.querySelectorAll(".proj-step.completed")).toHaveLength(1);
    fireEvent.click(toggle);
    expect(container.querySelectorAll(".proj-step.completed")).toHaveLength(0);
  });

  it("is there even when the page offers no Add a Task", () => {
    draw([step("b", "Hire plumber", true)]);
    expect(screen.getByRole("button", { name: "1 Finished" }).closest(".sh2")).not.toBeNull();
  });
});
