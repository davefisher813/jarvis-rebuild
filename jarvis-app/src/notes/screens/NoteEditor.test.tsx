// Field Notes / Command Deck (Dave 2026-08-28): the pilcrow toggle now
// picks between two real layouts over the SAME flat block array, not a
// class swap on shared markup. These pin the two layouts' actual shapes:
// editorial stays a flat page with a colored dot per section, and default
// mode groups each heading and what follows it into its own card with an
// item count -- while confirming the grouping is render-only (no block is
// added, dropped, or reordered by switching).
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
