// @vitest-environment jsdom
// Brain Manual v1 (the filing doors as Dave taps them).
//
// NoteEditor: "File As…" sits in the note's existing More menu, files the
// selection when one exists (else the whole note), and renders disabled on
// an empty note. QuickCapture: the + menu's two filing doors open the one
// filing sheet (3 fields max) with the right mode and source.
import "../shared/tiptapTest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { NotesProvider, useNotes, useOptionalBrainMemory } from "../data/NotesProvider";
import NotesFlow from "../notes/NotesFlow";
import QuickCapture from "../capture/QuickCapture";
import type { BrainMemoryService } from "./brainMemoryService";
import type { AIService } from "../ai/AIService";

vi.mock("../data/store", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../data/store")>();
  return { ...mod, makeStore: () => new Store(new InMemoryAdapter()) };
});

let svcRef: ReturnType<typeof useNotes> | null = null;
let brainRef: BrainMemoryService | null = null;
function Grab() {
  svcRef = useNotes();
  brainRef = useOptionalBrainMemory();
  return null;
}

async function openNoteWithText(text: string, blankTitle = false) {
  svcRef = null;
  brainRef = null;
  const user = "u-file-as-" + Math.random().toString(36).slice(2);
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(svcRef && brainRef).toBeTruthy());
  const svc = svcRef!;
  let id = "";
  await act(async () => {
    // createNote rejects a blank title, so a truly empty note is born with
    // a title and has it blanked after -- the same trick the notes suite
    // uses for its empty-title cases.
    id = (await svc.createNote("Race", ""))!;
    if (blankTitle) await svc.editTitle(id, " ");
    if (text) await svc.addBlock(id, { type: "text", text });
  });
  view.rerender(<NotesProvider userId={user}><Grab /><NotesFlow openId={id} /></NotesProvider>);
  await waitFor(() => expect(screen.getByLabelText("Note")).toBeInTheDocument());
  return { id };
}

describe("NoteEditor → File As…", () => {
  it("files the whole note from the More menu and names the destination", async () => {
    await openNoteWithText("Discipline beats motivation.");
    fireEvent.click(screen.getByLabelText("Note options"));
    const item = await screen.findByText("File As…");
    expect(item).toBeInTheDocument();
    expect(item.closest("button")).not.toBeDisabled();
    fireEvent.click(item);
    // The one filing sheet: pick Philosophy, one tap, no form.
    await screen.findByText("File As…", { selector: ".eyebrow" });
    fireEvent.click(screen.getByText("Philosophy"));
    await waitFor(async () => {
      const rows = await brainRef!.listByCategory("philosophy");
      expect(rows.length).toBe(1);
      expect(rows[0]!.data.text).toContain("Discipline beats motivation.");
      expect(rows[0]!.data.source).toBe("note");
    });
  });

  it("an empty note renders the menu item disabled", async () => {
    await openNoteWithText("", true);
    fireEvent.click(screen.getByLabelText("Note options"));
    const item = await screen.findByText("File As…");
    expect(item.closest("button")).toBeDisabled();
  });
});

describe("QuickCapture → the + menu filing doors", () => {
  const ai = {} as AIService;
  function renderCapture() {
    const user = "u-qc-" + Math.random().toString(36).slice(2);
    render(
      <NotesProvider userId={user}>
        <QuickCapture ai={ai} onClose={() => {}} />
      </NotesProvider>,
    );
  }
  it("offers Log the Decision and Remember This without disturbing Smart Paste", async () => {
    renderCapture();
    // Smart Paste is untouched: its own hero button is still here.
    expect(await screen.findByText("Capture")).toBeInTheDocument();
    expect(screen.getByText("Log the Decision")).toBeInTheDocument();
    expect(screen.getByText("Remember This")).toBeInTheDocument();
  });
  it("Log the Decision opens the filing sheet in decision mode", async () => {
    renderCapture();
    fireEvent.click(await screen.findByText("Log the Decision"));
    await screen.findByText("Log the Decision", { selector: ".eyebrow" });
    expect(screen.getByPlaceholderText("The Decision")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Why (Optional)")).toBeInTheDocument();
  });
  it("Remember This opens the filing sheet with the category picker", async () => {
    renderCapture();
    fireEvent.click(await screen.findByText("Remember This"));
    await screen.findByText("Remember This", { selector: ".eyebrow" });
    expect(screen.getByText("Philosophy")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });
});
