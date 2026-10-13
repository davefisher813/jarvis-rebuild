// @vitest-environment jsdom
// Issue #115 F and H on the Notes home: existing material leads (search,
// pinned, recent, the area filter), the three ways to start follow it, and a
// template page's row menu exports, shares and duplicates it.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import NotesList, { type NoteListItem } from "../screens/NotesList";
import { setCategoryRegistry } from "../../shared/categories";
import { capsulesInCards } from "../../laws/catalogCheck";

setCategoryRegistry([{ id: "c-kids", name: "Kids", color: "green" }]);
const NOW = Date.now();
const notes: NoteListItem[] = [
  { id: "p1", title: "Pinned Plan", edited: NOW - 5 * 86400000, category: "", first: "", body: "", pinned: true },
  { id: "t1", title: "Tigers", edited: NOW, category: "c-kids", first: "", body: "Ava Chen", lines: ["3 Players"], page: "team" },
  { id: "n1", title: "Groceries", edited: NOW, category: "", first: "", body: "" },
];

describe("Notes home order", () => {
  it("search, pinned, recent and the area filter come before New Note, Use a Template and Import", () => {
    const { container } = render(<NotesList notes={notes} onNewNote={vi.fn()} onBlankNote={vi.fn()} onImportTable={vi.fn()} onPasteRows={vi.fn()} />);
    // The heads down the page, in order: what he has first, then the way to start something.
    const heads = [...container.querySelectorAll(".sh2 .t")].map((e) => e.textContent);
    expect(heads).toEqual(["Pinned", "Today", "Start Something"]);
    expect(screen.getByPlaceholderText("Search Notes")).toBeInTheDocument();
    expect(screen.getByLabelText("Area")).toBeInTheDocument();
    const start = [...container.querySelectorAll(".set-card .conn-name")].map((e) => e.textContent);
    expect(start).toEqual(["New Note", "Use a Template", "Import"]);
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("Import offers a roster from Sheets or Excel and a paste, and each runs", () => {
    const onImportTable = vi.fn();
    const onPasteRows = vi.fn();
    render(<NotesList notes={notes} onNewNote={vi.fn()} onBlankNote={vi.fn()} onImportTable={onImportTable} onPasteRows={onPasteRows} />);
    fireEvent.click(screen.getByText("Import"));
    fireEvent.click(screen.getByText("A Roster from Sheets or Excel"));
    expect(onImportTable).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Import"));
    fireEvent.click(screen.getByText("Paste Rows"));
    expect(onPasteRows).toHaveBeenCalledTimes(1);
  });

  it("a search hides the start rows so the results stand alone", () => {
    render(<NotesList notes={notes} onNewNote={vi.fn()} onBlankNote={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Search Notes"), { target: { value: "ava" } });
    expect(screen.getByText("Tigers")).toBeInTheDocument();
    expect(screen.queryByText("Start Something")).toBeNull();
  });
});

describe("a template page's row menu", () => {
  it("adds Export or Share and Duplicate Page, and drops Add a Line", () => {
    const onShare = vi.fn();
    const onDuplicate = vi.fn();
    render(<NotesList notes={notes} onShare={onShare} onDuplicate={onDuplicate} onAppend={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("Tigers"));
    const sheet = document.querySelector(".action-sheet") as HTMLElement;
    const labels = [...sheet.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("Export or Share");
    expect(labels).toContain("Duplicate Page");
    expect(labels).not.toContain("Add a Line");
    fireEvent.click(within(sheet).getByText("Export or Share"));
    expect(onShare).toHaveBeenCalledWith("t1");
  });

  it("an ordinary note's menu is unchanged", () => {
    render(<NotesList notes={notes} onShare={vi.fn()} onDuplicate={vi.fn()} onAppend={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.contextMenu(screen.getByText("Groceries"));
    const labels = [...document.querySelector(".action-sheet")!.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["Add a Line", "Delete"]);
  });
});
