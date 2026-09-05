// The writing toolbar (Dave 2026-08-18): typed-block chips ride the bottom
// of every note. Each chip creates its block type; More opens the full
// block library. This pins the chip set and the wiring.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, createEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import NoteEditor from "./NoteEditor";

const note = { category: "family", eyebrow: "Family", title: "Rob Calder", blocks: [] };

describe("Writing toolbar", () => {
  it("offers the four typed blocks plus More, each wired to its type", () => {
    const typed: string[] = [];
    let moreOpened = false;
    render(<NoteEditor note={note} onAddTyped={(t) => typed.push(t)} onAddBlock={() => { moreOpened = true; }} />);
    fireEvent.click(screen.getByText("Text"));
    fireEvent.click(screen.getByText("Heading"));
    fireEvent.click(screen.getByText("List"));
    fireEvent.click(screen.getByText("Checklist"));
    expect(typed).toEqual(["text", "heading", "bulleted_list", "checklist"]);
    fireEvent.click(screen.getByText("More"));
    expect(moreOpened).toBe(true);
  });

  // HMN-F-01 (2026-09-05): a chip tap used to blur the block being typed in,
  // so the blur-save and the add raced and the paragraph reverted. Every
  // chip now swallows mousedown (the guard Add Row has carried since the
  // deep template pass), so the caret stays where it is until the new block
  // takes it.
  it("every chip swallows mousedown so the tap does not blur-save the block being typed", () => {
    render(<NoteEditor note={note} onAddTyped={() => {}} onAddBlock={() => {}} />);
    for (const label of ["Text", "Heading", "List", "Checklist", "More"]) {
      const chip = screen.getByText(label);
      const ev = createEvent.mouseDown(chip);
      fireEvent(chip, ev);
      expect(ev.defaultPrevented, label).toBe(true);
    }
  });
});
