// @vitest-environment jsdom
import "../shared/tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { NotesService } from "./NotesService";
import NotesFlow from "./NotesFlow";

// THE FIRST LOAD FAILED (research standard, section 5 rule 18, 2026-10-19). The Notes library drew as an empty one when its first read failed. It says what
// could not be read and offers Retry, the one filled primary; Retry reads again, and a later refresh that fails with notes on screen keeps them.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Notes: the first load failing", () => {
  it("draws Couldn't Load Your Notes with Retry instead of an empty library, and Retry reads again", async () => {
    vi.spyOn(NotesService.prototype, "listNotes").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="notes-load-fail"><NotesFlow /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load Your Notes")).toBeInTheDocument();
    expect(document.querySelector(".empty-state .btn-primary")).toHaveTextContent("Retry");
    expect(screen.queryByText("Start Something")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("Couldn't Load Your Notes")).toBeNull());
    expect(await screen.findByText("Start Something")).toBeInTheDocument();
  });

  it("a healthy first load never draws it", async () => {
    render(<NotesProvider userId="notes-load-ok"><NotesFlow /></NotesProvider>);
    expect(await screen.findByText("Start Something")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't Load Your Notes")).toBeNull();
  });
});
