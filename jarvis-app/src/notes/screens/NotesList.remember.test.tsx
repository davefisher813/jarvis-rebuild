// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import NotesList, { type NoteListItem } from "./NotesList";

// THE REMEMBER STAR ON A NOTE ROW (2026-10-05, the visual review: "the leading star on every row is a 14px thin outline hugging the card's edge").
// An empty star on every row is noise and took a column; the row wears it only while the note is remembered, in the gutter, as a task row does,
// and remembering it is the long press (Remember, then Forget once it is). The strand store is replaced by a double so the test owns both states.

const run = vi.fn(async () => {});
let on = false;
vi.mock("../../shared/EntityStar", () => ({
  default: ({ quiet }: { quiet?: boolean }) => (quiet && !on ? null : <button type="button" className={"row-star" + (on ? " on" : "")} aria-label="Forget this" />),
  useRemember: () => ({ on, run }),
}));

const notes: NoteListItem[] = [{ id: "n1", title: "Coach Onboarding Plan", edited: Date.now(), category: "", first: "", body: "" }];

describe("NotesList: the Remember star", () => {
  it("draws no star on a note that is not remembered, and offers Remember on the long press", () => {
    on = false; run.mockClear();
    const { container } = render(<NotesList notes={notes} onDelete={vi.fn()} onArchive={vi.fn()} />);
    expect(container.querySelector(".note-row .row-star"), "an empty star on every row is gone").toBeNull();
    fireEvent.contextMenu(screen.getByText("Coach Onboarding Plan"));
    const sheet = document.querySelector(".action-sheet") as HTMLElement;
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)[0]).toBe("Remember");
    fireEvent.click(within(sheet).getByText("Remember"));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a remembered note wears the filled star, and its long press offers Forget", () => {
    on = true; run.mockClear();
    const { container } = render(<NotesList notes={notes} onDelete={vi.fn()} onArchive={vi.fn()} />);
    expect(container.querySelector(".note-row > .row-star.on")).not.toBeNull();
    fireEvent.contextMenu(screen.getByText("Coach Onboarding Plan"));
    const sheet = document.querySelector(".action-sheet") as HTMLElement;
    expect(within(sheet).getByText("Forget")).toBeInTheDocument();
  });
});
