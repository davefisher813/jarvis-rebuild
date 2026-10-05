// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import NotesList, { type NoteListItem } from "./NotesList";
import { capsulesInCards } from "../../laws/catalogCheck";
import { setCategoryRegistry } from "../../shared/categories";

// A NOTE IS A CLEAN ROW (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md).
//
//   tap          opens the note (a deleted note opens its menu)
//   swipe left   the quickest verb, Archive; then Delete behind it
//   long press   the menu, every action again
//   no pill on the row, and the Add is the page head's (LifeHeader's New Note)

setCategoryRegistry([{ id: "c-work", name: "Work", color: "blue" }]);

const NOW = new Date().getTime();
const live: NoteListItem[] = [
  { id: "n1", title: "coach onboarding plan", edited: NOW, category: "c-work", first: "", body: "" },
];
const archived: NoteListItem[] = [{ id: "a1", title: "Old Roster", edited: NOW, category: "", first: "", body: "", archived: true }];
const deleted: NoteListItem[] = [{ id: "d1", title: "Gone Draft", edited: NOW, category: "", first: "", body: "", deleted: true }];

function openView(name: RegExp) {
  fireEvent.click(screen.getByLabelText("View"));
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

describe("NotesList: clean rows", () => {
  it("a live note carries no capsule, and the page's Add is in the head", () => {
    const { container } = render(<NotesList notes={live} onDelete={vi.fn()} onArchive={vi.fn()} onNewNote={vi.fn()} />);
    expect(container.querySelector(".note-row .pill-act, .note-row .row-act, .note-row .btn-sm")).toBeNull();
    expect(capsulesInCards(container)).toEqual([]);
    expect(screen.getByLabelText("New Note").closest(".card")).toBeNull();
  });

  it("swipe left is Archive first and Delete behind it, each naming its note", () => {
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    render(<NotesList notes={live} onDelete={onDelete} onArchive={onArchive} />);
    const tray = document.querySelector(".task-swipe")!;
    const buttons = [...tray.querySelectorAll(":scope > button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Archive coach onboarding plan", "Delete coach onboarding plan"]);
    expect(buttons[0]!.className).toContain("task-verb");
    fireEvent.click(buttons[0]!);
    expect(onArchive).toHaveBeenCalledWith("n1", true);
    fireEvent.click(buttons[1]!);
    expect(onDelete).toHaveBeenCalledWith("n1");
  });

  it("an archived note's quickest verb brings it back", () => {
    const onArchive = vi.fn();
    render(<NotesList notes={[...live, ...archived]} onDelete={vi.fn()} onArchive={onArchive} />);
    openView(/Archived/);
    fireEvent.click(screen.getByLabelText("Unarchive Old Roster"));
    expect(onArchive).toHaveBeenCalledWith("a1", false);
  });

  it("the long press is the menu: every action again, and a pick runs it", () => {
    const onAppend = vi.fn();
    const onFile = vi.fn();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    render(<NotesList notes={live} onAppend={onAppend} onFile={onFile} onArchive={onArchive} onDelete={onDelete} />);
    fireEvent.contextMenu(screen.getByText("Coach Onboarding Plan"));
    const sheet = document.querySelector(".action-sheet")!;
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Add a Line", "File Under an Area", "Archive", "Delete"]);
    fireEvent.click(within(sheet as HTMLElement).getByText("File Under an Area"));
    expect(onFile).toHaveBeenCalledWith("n1");
  });

  it("a deleted note has no Restore capsule: its tap is its menu, and its swipe is Restore then Delete Forever", () => {
    const onRestore = vi.fn();
    const onDeleteForever = vi.fn();
    const { container } = render(<NotesList notes={[...live, ...deleted]} onDelete={vi.fn()} onRestore={onRestore} onDeleteForever={onDeleteForever} />);
    openView(/Recently Deleted/);
    expect(container.querySelector(".pill-act")).toBeNull();
    expect(capsulesInCards(container)).toEqual([]);
    const labels = [...container.querySelectorAll(".task-swipe > button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Restore Gone Draft", "Delete forever: Gone Draft"]);
    fireEvent.click(screen.getByText("Gone Draft"));
    const sheet = document.querySelector(".action-sheet")!;
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Restore", "Delete Forever"]);
    fireEvent.click(within(sheet as HTMLElement).getByText("Restore"));
    expect(onRestore).toHaveBeenCalledWith("d1");
  });

  it("every title it draws is Title Case", () => {
    render(<NotesList notes={live} onDelete={vi.fn()} />);
    expect(screen.getByText("Coach Onboarding Plan")).toBeInTheDocument();
  });
});
