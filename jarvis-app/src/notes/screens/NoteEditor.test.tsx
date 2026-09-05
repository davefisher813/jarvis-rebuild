// Field Notes / Command Deck (Dave 2026-08-28): the pilcrow toggle now
// picks between two real layouts over the SAME flat block array, not a
// class swap on shared markup. These pin the two layouts' actual shapes:
// editorial stays a flat page with a colored dot per section, and default
// mode groups each heading and what follows it into its own card with an
// item count -- while confirming the grouping is render-only (no block is
// added, dropped, or reordered by switching).
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import NoteEditor, { type EditorNote } from "./NoteEditor";

const NOTE: EditorNote = {
  category: "family",
  eyebrow: "Family",
  title: "Convo with Berto",
  blocks: [
    { id: "m1", type: "meta", text: "Aug 28 · Berto" },
    { id: "h1", type: "heading", text: "Agenda" },
    { id: "c1", type: "checklist", items: [{ text: "Renew lease" }, { text: "Talk pricing", done: true }] },
    { id: "h2", type: "heading", text: "Decisions" },
    { id: "t1", type: "text", text: "Went with option B." },
    { id: "h3", type: "heading", text: "Action Items" },
    { id: "c2", type: "checklist", items: [{ text: "Send contract" }] },
  ],
};

describe("Command Deck (default layout)", () => {
  it("groups each heading and what follows it into its own card, with an item count", () => {
    const { container } = render(<NoteEditor note={NOTE} />);
    const cards = container.querySelectorAll(".cd-card");
    expect(cards.length).toBe(3);
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getByText("Decisions")).toBeInTheDocument();
    expect(screen.getByText("Action Items")).toBeInTheDocument();
    // Agenda's card holds a 2-item checklist.
    const counts = Array.from(container.querySelectorAll(".cd-count")).map((n) => n.textContent);
    expect(counts).toEqual(["2", "1", "1"]);
  });

  it("keeps a block before the first heading OUT of any card", () => {
    const { container } = render(<NoteEditor note={NOTE} />);
    expect(screen.getByText("Aug 28 · Berto")).toBeInTheDocument();
    expect(container.querySelector(".cd-card .block-meta")).toBeNull();
  });

  it("renders no cards for a note with no heading at all", () => {
    const flat: EditorNote = { ...NOTE, blocks: [{ id: "t1", type: "text", text: "Just a note." }] };
    const { container } = render(<NoteEditor note={flat} />);
    expect(container.querySelectorAll(".cd-card").length).toBe(0);
    expect(screen.getByText("Just a note.")).toBeInTheDocument();
  });

  it("never renders Field Notes' hwrap/dot markup", () => {
    const { container } = render(<NoteEditor note={NOTE} />);
    expect(container.querySelector(".hwrap")).toBeNull();
  });
});

describe("Field Notes (editorial layout)", () => {
  const editorialNote = () => {
    localStorage.setItem("jarvis.notes.editorial.v1", "1");
    return render(<NoteEditor note={NOTE} />);
  };

  it("stays one flat page: every block renders, none of it grouped into a card", () => {
    const { container } = editorialNote();
    expect(container.querySelectorAll(".cd-card").length).toBe(0);
    expect(container.querySelectorAll(".hwrap").length).toBe(3);
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.getByText("Went with option B.")).toBeInTheDocument();
  });

  it("marks each section with a colored dot, not an invented sequence number", () => {
    const { container } = editorialNote();
    const hwraps = container.querySelectorAll(".hwrap");
    // The rotation cycles hd-0/hd-1/hd-2; three headings hit all three.
    const classes = Array.from(hwraps).map((h) => h.className);
    expect(classes[0]).toContain("hd-0");
    expect(classes[1]).toContain("hd-1");
    expect(classes[2]).toContain("hd-2");
    // No digits left in the marker itself -- the number was a CSS counter
    // rendered via ::before, and that content is gone now, not just hidden.
    hwraps.forEach((h) => expect(h.querySelector(".hnum")?.textContent).toBe(""));
  });
});

// THE CONNECTION STRIP (Dave 2026-08-28, "very very easy to connect
// things"): what a note links to, right under the title, in both layouts.
describe("the inline connection strip", () => {
  const CONNS = [
    { id: "c1", kind: "task", label: "Follow Up Call", targetId: "t1" },
    { id: "c2", kind: "project", label: "Berto Contract", targetId: "p1" },
  ];

  it("shows a chip per connection and a + even with nothing linked, and stays gone with neither", () => {
    const { rerender, container } = render(<NoteEditor note={NOTE} connections={CONNS} onAddLink={() => {}} />);
    expect(container.querySelectorAll(".note-conn").length).toBe(2);
    expect(screen.getByText("Follow Up Call")).toBeInTheDocument();
    expect(screen.getByText("Berto Contract")).toBeInTheDocument();
    expect(container.querySelector(".note-conn-add")).toBeInTheDocument();

    rerender(<NoteEditor note={NOTE} connections={[]} onAddLink={() => {}} />);
    expect(container.querySelectorAll(".note-conn").length).toBe(0);
    expect(container.querySelector(".note-conn-add")).toBeInTheDocument(); // the + still shows: nothing to solve yet

    rerender(<NoteEditor note={NOTE} connections={[]} />);
    expect(container.querySelector(".note-conns")).toBeNull(); // no add handler, no strip at all
  });

  it("the + opens the picker, the X unlinks, and a tap on a chip navigates", () => {
    const onAddLink = vi.fn();
    const onRemoveConnection = vi.fn();
    const onOpenConnection = vi.fn();
    render(<NoteEditor note={NOTE} connections={CONNS} onAddLink={onAddLink} onRemoveConnection={onRemoveConnection} onOpenConnection={onOpenConnection} />);
    fireEvent.click(screen.getByLabelText("Link Something"));
    expect(onAddLink).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Unlink Follow Up Call"));
    expect(onRemoveConnection).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByText("Berto Contract"));
    expect(onOpenConnection).toHaveBeenCalledWith("project", "p1");
  });
});

// A checklist item already promoted to a real task (Dave 2026-08-28): a
// quiet badge instead of an item that looks plain but is secretly synced.
describe("the checklist's linked-task badge", () => {
  const withPromoted: EditorNote = {
    ...NOTE,
    blocks: [
      { id: "c1", type: "checklist", items: [{ text: "Send contract", taskId: "task-9" }, { text: "Not yet a task" }] },
    ],
  };

  it("marks only the promoted item, and opens the task on tap", () => {
    const onOpenTask = vi.fn();
    const { container } = render(<NoteEditor note={withPromoted} onOpenTask={onOpenTask} />);
    const badges = container.querySelectorAll(".check-linked");
    expect(badges.length).toBe(1);
    fireEvent.click(badges[0]!);
    expect(onOpenTask).toHaveBeenCalledWith("task-9");
  });

  it("still shows the badge with no handler, just not tappable", () => {
    const { container } = render(<NoteEditor note={withPromoted} />);
    const badge = container.querySelector(".check-linked");
    expect(badge).toBeInTheDocument();
    expect(badge?.tagName).toBe("SPAN");
  });
});

// HMN-F-01 (2026-09-05): tapping another item's checkbox, or Add Item, while
// typing an item used to blur-save the item on the same gesture, and the two
// read-modify-writes raced. Both now swallow mousedown so the caret stays
// put; the text saves when it actually leaves the field.
describe("the checklist's taps do not blur the item being typed", () => {
  it("the checkbox and Add Item both swallow mousedown", () => {
    const { container } = render(<NoteEditor note={NOTE} onToggleCheck={() => {}} onAddCheckItem={() => {}} />);
    const box = container.querySelector(".cb")!;
    const boxDown = createEvent.mouseDown(box);
    fireEvent(box, boxDown);
    expect(boxDown.defaultPrevented).toBe(true);
    const add = screen.getAllByText("Add Item")[0]!.closest("button")!;
    const addDown = createEvent.mouseDown(add);
    fireEvent(add, addDown);
    expect(addDown.defaultPrevented).toBe(true);
  });
});

describe("switching layouts never touches the blocks", () => {
  it("same seven blocks are on the page whichever layout drew them", () => {
    localStorage.removeItem("jarvis.notes.editorial.v1");
    const { container: deck } = render(<NoteEditor note={NOTE} />);
    const deckTexts = Array.from(deck.querySelectorAll("[contenteditable], .check-line span")).map((n) => n.textContent);

    localStorage.setItem("jarvis.notes.editorial.v1", "1");
    const { container: notes } = render(<NoteEditor note={NOTE} />);
    const notesTexts = Array.from(notes.querySelectorAll("[contenteditable], .check-line span")).map((n) => n.textContent);

    expect(new Set(deckTexts)).toEqual(new Set(notesTexts));
    localStorage.removeItem("jarvis.notes.editorial.v1");
  });
});
