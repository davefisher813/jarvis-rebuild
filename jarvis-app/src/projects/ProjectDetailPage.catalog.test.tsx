// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
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

  // THE NOTE FIELD IS ON THE SURFACE (Dave 2026-10-17: "one normal-size note field with the Add Note action on the
  // detail surface, matching the app's standard entry treatment"). By his word it supersedes, here, the 2026-10-05
  // head capsule: the head carries the name and the count and no capsule; the card's first row is the standard field
  // with Add as its one quiet verb once there is something to add; Return adds too.
  const noteHead = (c: HTMLElement) => [...c.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === "Linked Notes")!;
  const noteField = (c: HTMLElement) => c.querySelector<HTMLInputElement>("input[placeholder=\"Add a Note\"]")!;
  const addVerb = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".row-ctx[aria-label=\"Add Note\"]");

  it("the Linked Notes head carries no capsule, and the card's first row is one standard note field", () => {
    const { container } = draw([], { onAddNote: () => {} });
    const head = noteHead(container);
    expect(head.querySelector("button, .pill-action, .pill-act, .row-act")).toBeNull();
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent === "Add a Note")).toHaveLength(0);
    const field = noteField(container);
    expect(field).not.toBeNull();
    expect(field).toHaveClass("input");
    expect(field.getAttribute("enterkeyhint")).toBe("done");
    expect(container.querySelectorAll("input[placeholder=\"Add a Note\"]")).toHaveLength(1);
    // The field row is a row of the list card under the head, and no capsule rides on it.
    const row = field.closest(".row")!;
    expect(row.closest(".list-card-ruled")).not.toBeNull();
    expect(row.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    // Nothing typed: no Add yet (the row's verb appears when its moment has come).
    expect(addVerb(container)).toBeNull();
  });

  it("Return saves the typed words, empties the field and keeps the keyboard on it", () => {
    const onAddNote = vi.fn();
    const { container } = draw([], { onAddNote });
    const field = noteField(container);
    field.focus();
    fireEvent.change(field, { target: { value: "Call the plumber" } });
    const add = addVerb(container)!;
    expect(add).not.toBeNull();
    expect(add.textContent).toBe("Add");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAddNote).toHaveBeenCalledTimes(1);
    expect(onAddNote).toHaveBeenCalledWith("Call the plumber");
    expect(field.value).toBe("");
    expect(document.activeElement).toBe(field);
    expect(addVerb(container)).toBeNull();
  });

  it("Add saves too; blank or whitespace saves nothing and shows no Add", () => {
    const onAddNote = vi.fn();
    const { container } = draw([], { onAddNote });
    const field = noteField(container);
    fireEvent.change(field, { target: { value: "   " } });
    expect(addVerb(container)).toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAddNote).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "Tile quote" } });
    fireEvent.click(addVerb(container)!);
    expect(onAddNote).toHaveBeenCalledWith("Tile quote");
    expect(field.value).toBe("");
  });

  it("with notes, the field is the first row and the notes follow it in Title Case; the row opens the note", () => {
    const onOpenNote = vi.fn();
    const { container } = draw([], { onAddNote: () => {}, onOpenNote, linkedNotes: [{ id: "n1", title: "Tile quote", category: "" }] });
    expect(noteHead(container).querySelector(".n")!.textContent).toBe("1");
    expect(noteHead(container).querySelector("button")).toBeNull();
    const card = noteField(container).closest(".list-card-ruled")!;
    expect(card.firstElementChild).toBe(noteField(container).closest(".row"));
    expect(card.children[1]!.textContent).toContain("Tile Quote");
    fireEvent.click(card.children[1]!);
    expect(onOpenNote).toHaveBeenCalledWith("n1");
  });

  it("the words survive a remount (rule 8) and are spent by the save, never by a blur", () => {
    localStorage.clear();
    const first = draw([], { onAddNote: () => {} });
    const field = noteField(first.container);
    fireEvent.change(field, { target: { value: "Ask about grout" } });
    fireEvent.blur(field);
    first.unmount();
    expect(localStorage.getItem("jarvis.project.note.draft.v1:p1")).toBe("Ask about grout");
    const second = draw([], { onAddNote: () => {} });
    expect(noteField(second.container).value).toBe("Ask about grout");
    fireEvent.keyDown(noteField(second.container), { key: "Enter" });
    expect(localStorage.getItem("jarvis.project.note.draft.v1:p1")).toBeNull();
    second.unmount();
    expect(noteField(draw([], { onAddNote: () => {} }).container).value).toBe("");
  });

  it("without a way to add, notes still list under the head with no field", () => {
    const { container } = draw([], { linkedNotes: [{ id: "n1", title: "Tile quote", category: "" }] });
    expect(container.querySelector("input[placeholder=\"Add a Note\"]")).toBeNull();
    expect(container.textContent).toContain("Tile Quote");
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
