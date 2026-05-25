// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks } from "../data/NotesProvider";
import { useEffect, useState } from "react";
import SearchFlow from "./SearchFlow";

function Seeded() {
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => { (async () => { await tasks.createTask("Email Sam", {}); setReady(true); })(); }, [tasks]);
  return ready ? <SearchFlow onClose={() => {}} /> : null;
}

describe("SearchFlow", () => {
  it("prompts when empty, then finds a seeded task", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    expect(await screen.findByText(/Search tasks, events/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search everything"), { target: { value: "sam" } });
    await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
  });
  it("Cancel calls onClose", () => {
    const onClose = vi.fn();
    render(<NotesProvider userId="u1"><SearchFlow onClose={onClose} /></NotesProvider>);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});
