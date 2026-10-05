// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProjectDetailPage, { type ProjectStep } from "./ProjectDetailPage";
import { setCategoryRegistry } from "../shared/categories";
import type { Project } from "./types";

// THE CATALOG HARD GATE (Dave 2026-10-05). The project page's own lines hold
// the rules every other row holds: a meaning wears its key colour (done is
// green, never the row's grey), every line the app writes is Title Case after
// a number too ("3 of 9 Done"), and a sub line is a fragment, not a sentence.
afterEach(cleanup);
setCategoryRegistry([]);

const project: Project = { id: "p1", data: { title: "Kitchen Remodel", status: "active" } } as Project;
const step = (id: string, text: string, done = false): ProjectStep => ({ id, text, done });
const draw = (steps: ProjectStep[], extra: Partial<Parameters<typeof ProjectDetailPage>[0]> = {}) => render(
  <ProjectDetailPage project={project} onBack={() => {}} onEdit={() => {}} steps={steps} today="2026-10-05" {...extra} />,
);

describe("ProjectDetailPage: the catalog", () => {
  it("every task done is the key's green, a fact, in Title Case", () => {
    const { container } = draw([step("a", "Order tile", true), step("b", "Hire plumber", true)]);
    const fact = [...container.querySelectorAll(".fact")].find((f) => /Every Task/i.test(f.textContent ?? ""))!;
    expect(fact.textContent).toBe("Every Task Is Done");
    expect(fact).toHaveClass("good");
    expect(fact.closest(".facts")).not.toBeNull();
    // Not the plain grey meta line it was.
    expect([...container.querySelectorAll(".conn-meta")].some((m) => /Every Task/i.test(m.textContent ?? ""))).toBe(false);
  });

  it("the progress count after a number is Title Case", () => {
    const { container } = draw([step("a", "Order tile", true), step("b", "Hire plumber"), step("c", "Paint")]);
    const line = container.querySelector(".proj-prog .conn-meta")!.textContent;
    expect(line).toBe("1 of 3 Done");
  });

  it("the finish note after a number is Title Case", () => {
    const { container } = draw([step("a", "Order tile"), step("b", "Hire plumber")], { onFinish: () => {} });
    expect(container.querySelector(".proj-finish-note")!.textContent).toBe("2 Tasks Are Still Open");
  });

  it("the guessed-area offer's line is a Title Case fragment, not a sentence", () => {
    setCategoryRegistry([{ id: "work", name: "Work", color: "blue" }]);
    try {
      const withCat = (id: string) => ({ ...step(id, "Task " + id), category: "work" });
      const { container } = draw([withCat("a"), withCat("b"), withCat("c")]);
      const row = container.querySelector(".proj-guess")!;
      expect(row.querySelector(".conn-name")!.textContent).toBe("Set Area to Work");
      expect(row.querySelector(".conn-meta")!.textContent).toBe("Most of This Project\u2019s Steps Are Already There");
    } finally { setCategoryRegistry([]); }
  });

  // AMENDED 2026-10-05 (Dave, locked): a section-level action lives in the
  // section head, never inside a card or at the foot of a list. With nothing to
  // list there is no card, so the head and its capsule are the whole section.
  it("Add a Task is the capsule on the Tasks head, with or without tasks, and never a row of the list", () => {
    const { container, unmount } = draw([], { onAddStep: () => {} });
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add a Task")!;
    expect(add.closest(".sh2")!.querySelector(".t")!.textContent).toBe("Tasks");
    expect(add).toHaveClass("see-all", "pill-action");
    expect([...container.querySelectorAll(".card, .list-card-ruled")].filter((c) => c.textContent?.trim() === "Add a Task")).toHaveLength(0);
    expect(container.querySelector(".notice-clear-row")).toBeNull();
    unmount();
    const withTasks = draw([step("a", "Order tile")], { onAddStep: () => {} });
    const add2 = [...withTasks.container.querySelectorAll("button")].find((b) => b.textContent === "Add a Task")!;
    expect(add2.closest(".sh2")).not.toBeNull();
    expect(add2.closest(".list-card-ruled"), "not at the foot of the list").toBeNull();
    expect(withTasks.container.querySelectorAll(".row-act")).toHaveLength(0);
  });

  it("Add a Note is the capsule on the Linked Notes head, with or without notes", () => {
    const { container, unmount } = draw([], { onAddNote: () => {} });
    const add = [...container.querySelectorAll("button")].find((b) => b.textContent === "Add a Note")!;
    expect(add.closest(".sh2")!.querySelector(".t")!.textContent).toBe("Linked Notes");
    expect([...container.querySelectorAll(".card, .list-card-ruled")].filter((c) => c.textContent?.trim() === "Add a Note")).toHaveLength(0);
    unmount();
    const withNote = draw([], { onAddNote: () => {}, linkedNotes: [{ id: "n1", title: "Tile quote", category: "" }] });
    const add2 = [...withNote.container.querySelectorAll("button")].find((b) => b.textContent === "Add a Note")!;
    expect(add2.closest(".sh2")).not.toBeNull();
    expect(add2.closest(".list-card-ruled")).toBeNull();
    // His note's title is shown in Title Case.
    expect(withNote.container.textContent).toContain("Tile Quote");
  });

  it("no sub line on the page is a sentence (no trailing period, no lowercase lead)", () => {
    const { container } = draw([step("a", "Order tile", true)]);
    for (const el of container.querySelectorAll(".conn-meta, .facts")) {
      const t = el.textContent ?? "";
      expect(t, t).not.toMatch(/\.$/);
      expect(t, t).not.toMatch(/^[a-z]/);
    }
  });
});
