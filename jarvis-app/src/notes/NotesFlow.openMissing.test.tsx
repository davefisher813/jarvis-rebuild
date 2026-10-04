// @vitest-environment jsdom
// NEVER AN EMPTY EDITOR (2026-10-04, the dead-button sweep). The AI Hub's Open
// It on a Kept as Note receipt hands the Notes tab the id of an exploration, an
// item NotesService.getNote refuses (it is not a note). openNote switched to
// the editor anyway: current stayed null, the editor drew nothing, the tab bar
// went away and no Back was on screen. It now says it could not and stays on
// the list.
import "../shared/tiptapTest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useNotes, useTasks } from "../data/NotesProvider";
import NotesFlow from "./NotesFlow";
import { subscribeToast, resetToasts } from "../shared/toast";

let notesRef: ReturnType<typeof useNotes> | null = null;
let tasksRef: ReturnType<typeof useTasks> | null = null;
function Grab() { notesRef = useNotes(); tasksRef = useTasks(); return null; }

let said: string[] = [];
beforeEach(() => {
  localStorage.clear();
  resetToasts();
  said = [];
  subscribeToast((t) => { if (t) said.push(t.message); });
  notesRef = null; tasksRef = null;
});

async function open(idOf: () => Promise<string>) {
  const user = "u-open-missing-" + Math.random().toString(36).slice(2);
  const onChrome = vi.fn();
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(notesRef && tasksRef).toBeTruthy());
  let id = "";
  await act(async () => { id = await idOf(); });
  view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id} onChrome={onChrome} /></NotesProvider>);
  return { onChrome };
}

describe("NotesFlow: an id that is not a loadable note", () => {
  it("an id that belongs to something else says so and stays on the list", async () => {
    // A task is an item the Notes service refuses to read as a note, which is
    // exactly what an exploration is.
    const { onChrome } = await open(async () => (await tasksRef!.createTask("Not a note", {}))!);
    await waitFor(() => expect(said).toContain("Couldn't Open That Note"));
    expect(screen.queryByLabelText("Note")).toBeNull();
    // The list keeps its tab bar; the editor is what takes it away.
    expect(onChrome).not.toHaveBeenCalledWith({ tabBar: false });
  });

  it("an id that does not exist at all says so too", async () => {
    await open(async () => "no-such-note");
    await waitFor(() => expect(said).toContain("Couldn't Open That Note"));
    expect(screen.queryByLabelText("Note")).toBeNull();
  });

  it("a real note still opens, with no complaint", async () => {
    await open(async () => (await notesRef!.createNote("Roster", ""))!);
    await waitFor(() => expect(screen.getByLabelText("Note")).toBeInTheDocument());
    expect(said).not.toContain("Couldn't Open That Note");
  });
});
