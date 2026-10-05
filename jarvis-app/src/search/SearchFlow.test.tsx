// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import { useEffect, useState } from "react";
import SearchFlow from "./SearchFlow";
import { NotesService } from "../notes/NotesService";

function Seeded() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => { (async () => { await tasks.createTask("Email Sam", {}); setReady(true); })(); }, [tasks]);
  return ready ? <SearchFlow onClose={() => {}} /> : null;
}

describe("SearchFlow", () => {
  it("prompts when empty, then finds a seeded task", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    expect(await screen.findByText("Find Anything")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Tasks, People, Notes"), { target: { value: "sam" } });
    await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
  });
  // THE EMPTY STATE SAYS WHAT TO TRY, NOT WHAT THE FIELD ALREADY SAYS (Dave 2026-10-05, the review). It repeated the placeholder
  // word for word. The field names what is searchable (Title Case, no typed dot) and the page under it says what to type.
  it("the idle state does not repeat the field's placeholder, and both are Title Case", async () => {
    render(<NotesProvider userId="u1"><SearchFlow onClose={() => {}} /></NotesProvider>);
    const field = await screen.findByPlaceholderText(/Tasks/) as HTMLInputElement;
    expect(field.placeholder).toBe("Tasks, People, Notes");
    expect(field.placeholder).not.toMatch(/\u00b7/);
    const title = document.querySelector(".empty-title");
    expect(title?.textContent).toBe("Find Anything");
    expect(title?.textContent).not.toBe(field.placeholder);
    expect(document.querySelector(".empty-sub")?.textContent).toBe("Try a Name, a Task, or a Note");
    // the page does not name the field a second time
    expect(document.body.textContent).not.toMatch(/Search Everything/);
  });
  it("Cancel calls onClose", () => {
    const onClose = vi.fn();
    render(<NotesProvider userId="u1"><SearchFlow onClose={onClose} /></NotesProvider>);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});

// Audit 2026-09-11 item 3 (fixed 2026-09-13): one failing list read used to
// blank search entirely.
describe("SearchFlow with one read failing", () => {
  it("still finds the task when the notes read throws", async () => {
    const spy = vi.spyOn(NotesService.prototype, "listNotes").mockRejectedValueOnce(new Error("offline"));
    try {
      render(<NotesProvider userId="u-fail"><Seeded /></NotesProvider>);
      fireEvent.change(await screen.findByPlaceholderText("Tasks, People, Notes"), { target: { value: "sam" } });
      await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

// THE TOP RESULT (audit 2026-09-29): "clicking the top result does nothing".
// A tap on the row and the keyboard's Search key both have to hand the first
// hit to the shell, and close the overlay behind it.
describe("SearchFlow: the top result opens", () => {
  function SeededOpen({ onOpen, onClose }: { onOpen: (k: string, id: string) => void; onClose: () => void }) {
    const tasks = useTasks();
    const [ready, setReady] = useState(false);
    useEffect(() => { (async () => { await tasks.createTask("Email Sam", {}); setReady(true); })(); }, [tasks]);
    return ready ? <SearchFlow onClose={onClose} onOpen={onOpen} /> : null;
  }
  it("a tap on the first row opens it and closes the overlay", async () => {
    const onOpen = vi.fn(); const onClose = vi.fn();
    render(<NotesProvider userId="u-top-tap"><SeededOpen onOpen={onOpen} onClose={onClose} /></NotesProvider>);
    fireEvent.change(await screen.findByPlaceholderText("Tasks, People, Notes"), { target: { value: "sam" } });
    fireEvent.click(await screen.findByText("Email Sam"));
    expect(onOpen).toHaveBeenCalledWith("task", expect.any(String));
    expect(onClose).toHaveBeenCalled();
  });
  // Dave's audit, 2026-10-04: submitting a query opened the first task's editor instead of showing the results.
  it("Enter in the field shows the results and opens nothing", async () => {
    const onOpen = vi.fn(); const onClose = vi.fn();
    render(<NotesProvider userId="u-top-enter"><SeededOpen onOpen={onOpen} onClose={onClose} /></NotesProvider>);
    const field = await screen.findByPlaceholderText("Tasks, People, Notes") as HTMLInputElement;
    field.focus();
    fireEvent.change(field, { target: { value: "sam" } });
    await screen.findByText("Email Sam");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onOpen, "the Search key must not open a row").not.toHaveBeenCalled();
    expect(onClose, "nor close the search").not.toHaveBeenCalled();
    expect(screen.getByText("Email Sam"), "the results stay on screen").toBeInTheDocument();
    expect(document.activeElement, "the keyboard is put away so every result is in view").not.toBe(field);
  });
});
