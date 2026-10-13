// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import NotesList, { type NoteListItem } from "./NotesList";

// ISSUE 105 (Alfred): "sometimes the confirmation appears, sometimes the menu
// just closes and the delete processes after a delay". Only Select inside
// Recently Deleted ever asked. EVERY user-initiated note delete (swipe tray,
// long-press menu, Select mode, Recently Deleted's Forever paths) opens one
// confirm sheet first, and nothing is written until its destructive button is
// tapped. These tests fail on the code before the fix: the callbacks ran on
// the first tap and no sheet ever rendered.

const NOW = new Date().getTime();
const live: NoteListItem[] = [
  { id: "n1", title: "Coach Plan", edited: NOW, category: "", first: "", body: "" },
  { id: "n2", title: "Roster Draft", edited: NOW, category: "", first: "", body: "" },
];
const gone: NoteListItem[] = [
  { id: "d1", title: "Gone One", edited: NOW, category: "", first: "", body: "", deleted: true },
  { id: "d2", title: "Gone Two", edited: NOW, category: "", first: "", body: "", deleted: true },
];

const SOFT_ONE = "Delete This Note, Restore It Within 30 Days";
const FOREVER_ONE = "Delete This Note for Good, No Undo";
const sheetTitle = () => document.querySelector(".sheet-scrim .eyebrow")?.textContent ?? null;
const openView = (name: RegExp) => {
  fireEvent.click(screen.getByLabelText("View"));
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
};
const startSelect = () => {
  fireEvent.click(screen.getByLabelText("Notes Options"));
  fireEvent.click(screen.getByText("Select Notes"));
};

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div"); host.id = "select-bar-host"; document.body.appendChild(host);
});
afterEach(() => host.remove());

describe("NotesList: every delete asks first", () => {
  it("swipe tray Delete opens the sheet on the first tap, writes nothing, and Cancel leaves it unwritten", () => {
    const onDelete = vi.fn();
    render(<NotesList notes={live} onDelete={onDelete} />);
    expect(sheetTitle()).toBeNull();
    fireEvent.click(screen.getByLabelText("Delete Coach Plan"));
    expect(sheetTitle()).toBe(SOFT_ONE);
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(sheetTitle()).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("the soft sheet never claims a restorable delete cannot be undone", () => {
    render(<NotesList notes={live} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Delete Coach Plan"));
    expect(sheetTitle()).not.toMatch(/undo|undone|for good/i);
  });

  it("swipe tray Delete runs onDelete once, with the right id, after the destructive button", () => {
    const onDelete = vi.fn();
    render(<NotesList notes={live} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Delete Roster Draft"));
    fireEvent.click(within(document.querySelector(".sheet-scrim .action-sheet") as HTMLElement).getByText("Delete Note"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("n2");
    expect(sheetTitle()).toBeNull();
  });

  it("the long-press menu's Delete closes into the confirm instead of just closing", () => {
    const onDelete = vi.fn();
    render(<NotesList notes={live} onDelete={onDelete} />);
    fireEvent.contextMenu(screen.getByText("Coach Plan"));
    fireEvent.click(within(document.querySelector(".action-sheet") as HTMLElement).getByText("Delete"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(sheetTitle()).toBe(SOFT_ONE);
    fireEvent.click(screen.getByText("Delete Note"));
    expect(onDelete).toHaveBeenCalledWith("n1");
  });

  it("Select mode asks with the count, deletes only after confirm, and exits select only then", () => {
    const onDeleteMany = vi.fn();
    render(<NotesList notes={live} onDeleteMany={onDeleteMany} />);
    startSelect();
    fireEvent.click(screen.getByText("Select All"));
    fireEvent.click(document.querySelector(".select-del")!);
    expect(onDeleteMany).not.toHaveBeenCalled();
    expect(sheetTitle()).toBe("Delete 2 Notes, Restore Within 30 Days");
    // Cancel keeps the selection standing.
    fireEvent.click(screen.getByText("Cancel"));
    expect(document.querySelector(".select-del")).not.toBeNull();
    fireEvent.click(document.querySelector(".select-del")!);
    fireEvent.click(screen.getByText("Delete 2 Notes"));
    expect(onDeleteMany).toHaveBeenCalledTimes(1);
    expect(onDeleteMany).toHaveBeenCalledWith(["n1", "n2"]);
    expect(document.querySelector(".select-del")).toBeNull();
  });
});

describe("NotesList: Recently Deleted's Forever paths ask first", () => {
  it("the swipe's Forever opens the permanent sheet and deletes nothing until Delete Note Forever", () => {
    const onDeleteForever = vi.fn();
    render(<NotesList notes={[...live, ...gone]} onDelete={vi.fn()} onDeleteForever={onDeleteForever} onRestore={vi.fn()} />);
    openView(/Recently Deleted/);
    fireEvent.click(screen.getByLabelText("Delete forever: Gone One"));
    expect(onDeleteForever).not.toHaveBeenCalled();
    expect(sheetTitle()).toBe(FOREVER_ONE);
    fireEvent.click(screen.getByText("Delete Note Forever"));
    expect(onDeleteForever).toHaveBeenCalledTimes(1);
    expect(onDeleteForever).toHaveBeenCalledWith("d1");
  });

  it("the row menu's Delete Forever opens the permanent sheet too", () => {
    const onDeleteForever = vi.fn();
    render(<NotesList notes={[...live, ...gone]} onDelete={vi.fn()} onDeleteForever={onDeleteForever} onRestore={vi.fn()} />);
    openView(/Recently Deleted/);
    fireEvent.click(screen.getByText("Gone Two"));
    fireEvent.click(within(document.querySelector(".action-sheet") as HTMLElement).getByText("Delete Forever"));
    expect(onDeleteForever).not.toHaveBeenCalled();
    expect(sheetTitle()).toBe(FOREVER_ONE);
    fireEvent.click(screen.getByText("Delete Note Forever"));
    expect(onDeleteForever).toHaveBeenCalledWith("d2");
  });

  it("Select there deletes for good, after confirm, through the bulk callback only", () => {
    const onDeleteMany = vi.fn();
    const onDeleteManyForever = vi.fn();
    render(<NotesList notes={[...live, ...gone]} onDeleteMany={onDeleteMany} onDeleteManyForever={onDeleteManyForever} />);
    openView(/Recently Deleted/);
    startSelect();
    fireEvent.click(screen.getByText("Select All"));
    fireEvent.click(document.querySelector(".select-del")!);
    expect(sheetTitle()).toBe("Delete 2 Notes for Good, No Undo");
    expect(onDeleteManyForever).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete 2 Notes Forever"));
    expect(onDeleteManyForever).toHaveBeenCalledWith(["d1", "d2"]);
    expect(onDeleteMany).not.toHaveBeenCalled();
  });
});
