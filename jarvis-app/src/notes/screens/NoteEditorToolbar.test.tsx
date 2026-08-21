// The writing toolbar (Dave 2026-08-18): typed-block chips ride the bottom
// of every note. Each chip creates its block type; More opens the full
// block library. This pins the chip set and the wiring.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});
