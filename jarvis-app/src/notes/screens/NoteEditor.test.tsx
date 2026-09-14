// THE NOTE SCREEN (the writing system, 2026-09-14): one document under a
// title, Back and More in the header, Delete inside More, the connections
// and the word count under the writing, and a save line that says only what
// is true. These pin the shape.
// @vitest-environment jsdom
import "../../shared/tiptapTest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import NoteEditor, { type EditorNote } from "./NoteEditor";
import { blocksToDoc } from "../docModel";
import { subscribeToast, resetToasts } from "../../shared/toast";

const NOTE: EditorNote = {
  category: "family",
  eyebrow: "Family",
  title: "Convo with Berto",
  doc: blocksToDoc([
    { id: "h1", type: "heading", text: "Agenda" },
    { id: "c1", type: "checklist", items: [{ text: "Renew lease", done: false }, { text: "Talk pricing", done: true, taskId: "task-9" }] },
    { id: "t1", type: "text", text: "Went with option B." },
  ]),
  attachments: [],
};

const base = { note: NOTE, onBack: () => {}, onDocChange: () => {} };

describe("the header", () => {
  it("is Back and More; Delete, Connections, Pin, Tags, Archive and the checklist door live inside More", () => {
    const onDeleteNote = vi.fn();
    const onCreateTasks = vi.fn();
    render(<NoteEditor {...base} onDeleteNote={onDeleteNote} onConnections={() => {}} onPin={() => {}} onTags={() => {}} onArchive={() => {}} onCreateTasks={onCreateTasks} />);
    expect(screen.queryByLabelText("Delete note")).toBeNull();
    expect(screen.getByText("Notes", { selector: "button" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Note options"));
    const items = screen.getAllByRole("menuitem").map((b) => b.textContent?.trim());
    // The caret opens inside the first section, so the section actions are offered too.
    expect(items).toEqual(["Connections", "Pin Note", "Tags", "Copy As", "Find in Note", "Outline", "Move Section Up", "Move Section Down", "Copy Section", "Make Tasks from Checklist", "Archive", "Delete Note"]);
    fireEvent.click(screen.getByText("Delete Note"));
    expect(onDeleteNote).toHaveBeenCalledTimes(1);
  });

  it("offers the checklist door only when the note has a checklist", () => {
    const plain: EditorNote = { ...NOTE, doc: blocksToDoc([{ id: "t", type: "text", text: "Only words" }]) };
    render(<NoteEditor {...base} note={plain} onCreateTasks={() => {}} onDeleteNote={() => {}} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    expect(screen.queryByText("Make Tasks from Checklist")).toBeNull();
  });
});

describe("the document", () => {
  it("renders as one surface with the note's words, the linked line marked, and the title above it", () => {
    const { container } = render(<NoteEditor {...base} />);
    const pm = container.querySelector(".doc-pm")!;
    expect(pm).toBeInTheDocument();
    expect(pm.textContent).toContain("Agenda");
    expect(pm.textContent).toContain("Went with option B.");
    expect(container.querySelectorAll("ul[data-type='taskList'] li").length).toBe(2);
    expect(container.querySelector("li[data-task-id='task-9']")).toBeInTheDocument();
    // No per-block menus, no repeated cues.
    expect(container.querySelectorAll(".block-menu-btn").length).toBe(0);
    expect(container.textContent).not.toContain("Write Something");
    expect(container.textContent).not.toContain("List Item");
    const html = container.innerHTML;
    expect(html.indexOf("doc-title")).toBeLessThan(html.indexOf("doc-pm"));
  });

  it("counts the words under the page, headings excluded", () => {
    render(<NoteEditor {...base} />);
    expect(screen.getByText(/^8 words$/i)).toBeInTheDocument();
  });
});

describe("Copy", () => {
  it("copies the whole note, title first, and says so only once the clipboard took it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Copy Note"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text.startsWith("Convo with Berto\n\nAGENDA\n")).toBe(true);
    expect(text).toContain("[x] Talk pricing");
    await waitFor(() => expect(seen).toContain("Note copied"));
    stop(); resetToasts();
  });

  it("Copy As offers the body, plain text and Markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Copy As"));
    fireEvent.click(await screen.findByText("Copy as Markdown"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0]![0] as string).startsWith("# Convo with Berto\n\n## Agenda")).toBe(true);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Copy As"));
    fireEvent.click(await screen.findByText("Copy Body Only"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect((writeText.mock.calls[1]![0] as string).startsWith("AGENDA")).toBe(true);
    await waitFor(() => expect(document.body.textContent).toBeDefined());
    resetToasts();
  });

  it("when the clipboard refuses, the words open already selected instead of a false confirmation", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    resetToasts();
    const seen: string[] = [];
    let armed = false;
    const stop = subscribeToast((t) => { if (t && armed) seen.push(t.message); });
    armed = true;
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Copy Note"));
    const field = await screen.findByLabelText("The note, ready to copy");
    expect((field as HTMLTextAreaElement).value).toContain("Went with option B.");
    expect(seen).toEqual([]);
    stop(); resetToasts();
  });

  it("Export opens the sheet on the note", async () => {
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Export Note"));
    expect(await screen.findByText("Export Note", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PDF/ })).toBeInTheDocument();
  });
});

describe("Find in Note and the Outline", () => {
  it("counts the matches, steps, and replaces all in one go", async () => {
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Find in Note"));
    const find = await screen.findByLabelText("Find");
    fireEvent.change(find, { target: { value: "lease" } });
    await waitFor(() => expect(screen.getByText("1 of 1")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "contract" } });
    fireEvent.click(screen.getByText("Replace All"));
    await waitFor(() => expect(screen.getByText("None")).toBeInTheDocument());
    expect(document.querySelector(".doc-pm")!.textContent).toContain("Renew contract");
    fireEvent.click(screen.getByLabelText("Close find"));
    expect(screen.queryByLabelText("Find")).toBeNull();
  });

  it("the Outline lists the headings and a tap goes to one", async () => {
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Outline"));
    const row = await screen.findByText("Agenda", { selector: ".doc-outline .conn-name" });
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByText("Agenda", { selector: ".doc-outline .conn-name" })).toBeNull());
  });
});

describe("Version History", () => {
  it("is offered only when versions exist, lists them newest first, and restores one", async () => {
    const onRestoreVersion = vi.fn();
    const versions = [
      { at: Date.parse("2026-09-13T09:00:00"), doc: blocksToDoc([{ id: "a", type: "text", text: "the first draft here" }]) },
      { at: Date.parse("2026-09-14T15:30:00"), doc: blocksToDoc([{ id: "b", type: "text", text: "a later draft" }]) },
    ];
    const { rerender } = render(<NoteEditor {...base} onRestoreVersion={onRestoreVersion} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    expect(screen.queryByText("Version History")).toBeNull();
    fireEvent.click(screen.getByLabelText("Note options"));
    rerender(<NoteEditor {...base} versions={versions} onRestoreVersion={onRestoreVersion} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Version History"));
    const rows = await screen.findAllByText(/words$/i, { selector: ".doc-outline .fact" });
    expect(rows.map((r) => r.textContent)).toEqual(["3 Words", "4 Words"]);
    fireEvent.click(rows[0]!);
    expect(await screen.findByText("a later draft", { selector: "pre" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Restore This Version"));
    expect(onRestoreVersion).toHaveBeenCalledWith(versions[1]!.at);
  });
});

describe("the save line", () => {
  it("says what is true and offers Retry only on a failure", () => {
    const onRetrySave = vi.fn();
    const { rerender } = render(<NoteEditor {...base} saveState="saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    rerender(<NoteEditor {...base} saveState="saved" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved on device");
    rerender(<NoteEditor {...base} saveState="synced" />);
    expect(screen.getByRole("status")).toHaveTextContent("Synced");
    expect(screen.queryByText("Retry")).toBeNull();
    rerender(<NoteEditor {...base} saveState="failed" onRetrySave={onRetrySave} />);
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't save");
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetrySave).toHaveBeenCalled();
  });
});

describe("the connection strip, under the writing now", () => {
  const CONNS = [
    { id: "c1", kind: "task", label: "Follow Up Call", targetId: "t1" },
    { id: "c2", kind: "project", label: "Berto Contract", targetId: "p1" },
  ];

  it("shows a chip per connection and a + even with nothing linked, and stays gone with neither", () => {
    const { rerender, container } = render(<NoteEditor {...base} connections={CONNS} onAddLink={() => {}} />);
    expect(container.querySelectorAll(".note-conn").length).toBe(2);
    expect(container.querySelector(".note-conn-add")).toBeInTheDocument();
    const html = container.innerHTML;
    expect(html.indexOf("doc-pm")).toBeLessThan(html.indexOf("note-conns"));

    rerender(<NoteEditor {...base} connections={[]} onAddLink={() => {}} />);
    expect(container.querySelectorAll(".note-conn").length).toBe(0);
    expect(container.querySelector(".note-conn-add")).toBeInTheDocument();

    rerender(<NoteEditor {...base} connections={[]} />);
    expect(container.querySelector(".note-conns")).toBeNull();
  });

  it("the + opens the picker, the X unlinks, and a tap on a chip navigates", () => {
    const onAddLink = vi.fn();
    const onRemoveConnection = vi.fn();
    const onOpenConnection = vi.fn();
    render(<NoteEditor {...base} connections={CONNS} onAddLink={onAddLink} onRemoveConnection={onRemoveConnection} onOpenConnection={onOpenConnection} />);
    fireEvent.click(screen.getByLabelText("Link Something"));
    expect(onAddLink).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Unlink Follow Up Call"));
    expect(onRemoveConnection).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByText("Berto Contract"));
    expect(onOpenConnection).toHaveBeenCalledWith("project", "p1");
  });
});
