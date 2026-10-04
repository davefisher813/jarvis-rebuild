// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import NotesList, { type NoteListItem } from "./NotesList";
import { setCategoryRegistry } from "../../shared/categories";

// 2026-10-04: two Notes controls that did not do what they said.
//
// 1. With text in the search box the View and Tag menus changed nothing: the
//    search started from every kept note, and its scope line named a view it
//    had not searched. A search now runs inside the chosen view or tag.
// 2. Select mode's Delete inside Recently Deleted re-deleted notes that were
//    already deleted. It is the permanent delete now, says so on the bar, and
//    asks first.

setCategoryRegistry([]);
const note = (id: string, title: string, over: Partial<NoteListItem> = {}): NoteListItem =>
  ({ id, title, edited: 1000, category: "", first: "", body: "plan", ...over });
const LIST: NoteListItem[] = [
  note("p1", "Pinned Plan", { pinned: true }),
  note("a1", "Plain Plan"),
  note("ar1", "Archived Plan", { archived: true }),
  note("t1", "Tagged Plan", { tags: ["q3"] }),
  note("d1", "Deleted Plan One", { deleted: true }),
  note("d2", "Deleted Plan Two", { deleted: true }),
];
const titles = (c: HTMLElement) => [...c.querySelectorAll(".note-row .task-name")].map((e) => e.textContent).sort();
const search = (v: string) => fireEvent.change(screen.getByPlaceholderText("Search Notes"), { target: { value: v } });
const pickView = (name: RegExp) => { fireEvent.click(screen.getByLabelText("View")); fireEvent.click(screen.getByRole("menuitemradio", { name })); };
const scopeLine = () => document.querySelector(".hdr-scope-n")?.textContent;

beforeEach(() => {
  document.getElementById("select-bar-host")?.remove();
  const host = document.createElement("div"); host.id = "select-bar-host"; document.body.appendChild(host);
});

describe("a Notes search runs inside the chosen view and tag", () => {
  it("with no cut it still reaches the archive and never the trash, and says All", () => {
    const { container } = render(<NotesList notes={LIST} />);
    search("plan");
    expect(titles(container)).toEqual(["Archived Plan", "Pinned Plan", "Plain Plan", "Tagged Plan"]);
    expect(scopeLine()).toBe("4 results in All notes");
    expect(screen.queryByText("Search all notes")).toBeNull();
  });

  it("Pinned narrows the typed search, the scope line says so, and Search all notes widens it for real", () => {
    const { container } = render(<NotesList notes={LIST} />);
    search("plan");
    pickView(/^Pinned/);
    expect(titles(container)).toEqual(["Pinned Plan"]);
    expect(scopeLine()).toBe("1 result in Pinned notes");
    fireEvent.click(screen.getByText("Search all notes"));
    expect(titles(container)).toHaveLength(4);
    expect(screen.getByLabelText("View")).toHaveTextContent("All");
    expect(scopeLine()).toBe("4 results in All notes");
  });

  it("a tag narrows the typed search and the scope line names the tag", () => {
    const { container } = render(<NotesList notes={LIST} />);
    search("plan");
    fireEvent.click(document.querySelector('.hdr-controls .dd[aria-label="Tag"]')!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "#q3" }));
    expect(titles(container)).toEqual(["Tagged Plan"]);
    expect(scopeLine()).toBe("1 result in #q3 notes");
  });

  it("Archived narrows the typed search to the archive", () => {
    const { container } = render(<NotesList notes={LIST} />);
    search("plan");
    pickView(/^Archived/);
    expect(titles(container)).toEqual(["Archived Plan"]);
    expect(scopeLine()).toBe("1 result in Archived notes");
  });

  it("Recently Deleted can be searched, and only it", () => {
    const { container } = render(<NotesList notes={LIST} />);
    search("two");
    expect(titles(container)).toEqual([]);
    pickView(/^Recently Deleted/);
    expect(titles(container)).toEqual(["Deleted Plan Two"]);
    expect(scopeLine()).toBe("1 result in Recently Deleted notes");
  });
});

describe("Delete in select mode inside Recently Deleted", () => {
  const openDeletedSelecting = (props: Partial<Parameters<typeof NotesList>[0]> = {}) => {
    const onDeleteMany = vi.fn();
    const onDeleteManyForever = vi.fn();
    render(<NotesList notes={LIST} onDeleteMany={onDeleteMany} onDeleteManyForever={onDeleteManyForever} {...props} />);
    pickView(/^Recently Deleted/);
    fireEvent.click(screen.getByLabelText("Notes Options"));
    fireEvent.click(screen.getByText("Select Notes"));
    fireEvent.click(screen.getByText("Select All"));
    return { onDeleteMany, onDeleteManyForever };
  };

  it("says Forever on the bar, asks first, and then deletes the ticked notes for good, not by re-trashing them", () => {
    const { onDeleteMany, onDeleteManyForever } = openDeletedSelecting();
    const del = document.querySelector(".select-del") as HTMLElement;
    expect(del).toHaveTextContent("Delete 2 Forever");
    fireEvent.click(del);
    expect(onDeleteManyForever).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Delete 2 Notes Forever"));
    expect(onDeleteManyForever).toHaveBeenCalledWith(["d1", "d2"]);
    expect(onDeleteMany).not.toHaveBeenCalled();
  });

  it("Cancel on the confirm deletes nothing and leaves the selection standing", () => {
    const { onDeleteMany, onDeleteManyForever } = openDeletedSelecting();
    fireEvent.click(document.querySelector(".select-del")!);
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onDeleteManyForever).not.toHaveBeenCalled();
    expect(onDeleteMany).not.toHaveBeenCalled();
    expect(document.querySelector(".select-del")).toHaveTextContent("Delete 2 Forever");
  });

  it("the live list's Delete is unchanged: no Forever, no confirm, Undo lives in the flow", () => {
    const onDeleteMany = vi.fn();
    const onDeleteManyForever = vi.fn();
    render(<NotesList notes={LIST} onDeleteMany={onDeleteMany} onDeleteManyForever={onDeleteManyForever} />);
    fireEvent.click(screen.getByLabelText("Notes Options"));
    fireEvent.click(screen.getByText("Select Notes"));
    fireEvent.click(screen.getByLabelText("Select Plain Plan"));
    const del = document.querySelector(".select-del") as HTMLElement;
    expect(del).not.toHaveTextContent("Forever");
    fireEvent.click(del);
    expect(onDeleteMany).toHaveBeenCalledWith(["a1"]);
    expect(onDeleteManyForever).not.toHaveBeenCalled();
  });

  it("without a permanent delete to run, Recently Deleted does not offer Select Notes at all", () => {
    render(<NotesList notes={LIST} onDeleteMany={vi.fn()} />);
    pickView(/^Recently Deleted/);
    fireEvent.click(screen.getByLabelText("Notes Options"));
    expect(screen.queryByText("Select Notes")).toBeNull();
  });
});
