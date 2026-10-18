// @vitest-environment jsdom
// TEMPLATE TAPS ANSWER AT ONCE (issue 106, V3; Dave 2026-10-13: "Pressed state
// plus a spinner the moment a template is tapped, while the editor loads. No
// more silent multi-second dead feel (which also causes duplicate notes from
// repeat taps)").
//
// Making a note from a template is two store writes, and opening it is several
// reads. The picker showed nothing in that time, and createNote is not
// idempotent, so every extra tap made another note. These tests hold the
// create open on a gate (no timers, no guessing at latency), so the window the
// person is looking at is exactly as long as the test says it is.
import "../shared/tiptapTest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState, type ReactNode } from "react";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useNotes } from "../data/NotesProvider";
import NotesFlow from "./NotesFlow";
import { subscribeToast, resetToasts } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

type Svc = ReturnType<typeof useNotes>;
let svcRef: Svc | null = null;
function Grab() { svcRef = useNotes(); return null; }

let said: string[] = [];
let stopToasts: (() => void) | null = null;
beforeEach(() => {
  localStorage.clear();
  resetToasts();
  said = [];
  stopToasts = subscribeToast((t) => { if (t) said.push(t.message); });
  svcRef = null;
});
afterEach(() => {
  stopToasts?.();
  stopToasts = null;
  vi.restoreAllMocks();
  resetToasts();
});

const rowOf = (name: string) => screen.getByText(name).closest(".lib-row") as HTMLElement;
const allRows = () => [...document.querySelectorAll<HTMLElement>(".lib-row")];
const notesIn = async (svc: Svc) => svc.listNotes({ includeDeleted: true });

/** Sign in, open Notes, tap New Note: the picker is on screen. */
async function openPicker(extra?: (id: string) => ReactNode) {
  const user = "u-templates-" + Math.random().toString(36).slice(2);
  const view = render(<NotesProvider userId={user}><Grab /><NotesFlow /></NotesProvider>);
  await waitFor(() => expect(svcRef).toBeTruthy());
  const svc = svcRef!;
  if (extra) {
    // A second note to be linked to, made before the picker opens.
    let other = "";
    await act(async () => { other = (await svc.createNote("Other Note", ""))!; });
    view.rerender(<NotesProvider userId={user}><Grab />{extra(other)}</NotesProvider>);
  }
  fireEvent.click(await screen.findByLabelText("New Note", {}, { timeout: 4000 }));
  await screen.findByText("Project Brief");
  return svc;
}

/** Hold the next creates open until release(): the busy window, as long as the test needs. */
function holdCreateNote(svc: Svc) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const real = svc.createNote.bind(svc);
  const spy = vi.spyOn(svc, "createNote").mockImplementation(async (...a) => { await gate; return real(...a); });
  return { release, spy };
}

describe("NotesFlow: one tap on a template makes one note", () => {
  it("two taps in the same tick, before React can repaint, make one note (the ref is the guard, not the state)", async () => {
    const svc = await openPicker();
    const { release, spy } = holdCreateNote(svc);
    const row = rowOf("Meeting Notes");
    // Both clicks are dispatched inside one act: React has not re-rendered between them,
    // so the second sees the row exactly as the first did. Only a synchronous guard stops it.
    act(() => { row.click(); row.click(); });
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await notesIn(svc)).toHaveLength(1);
  });

  it("a second tap after the row has repainted, on it or on its neighbour, is ignored too", async () => {
    const svc = await openPicker();
    const { release, spy } = holdCreateNote(svc);
    fireEvent.click(rowOf("Meeting Notes"));
    fireEvent.click(rowOf("Meeting Notes"));
    fireEvent.click(rowOf("Tracker"));
    fireEvent.click(rowOf("Blank"));
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
    const notes = await notesIn(svc);
    expect(notes).toHaveLength(1);
    expect((notes[0]!.data as { title: string }).title).toBe("Meeting Notes");
  });

  it("Blank, which has its own door into the store, is held to the same one note", async () => {
    const svc = await openPicker();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const real = svc.createBlankNote.bind(svc);
    const spy = vi.spyOn(svc, "createBlankNote").mockImplementation(async (...a) => { await gate; return real(...a); });
    act(() => { rowOf("Blank").click(); rowOf("Blank").click(); });
    fireEvent.click(rowOf("Blank"));
    expect(spy).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await notesIn(svc)).toHaveLength(1);
  });
});

describe("NotesFlow: the tapped row answers in the same turn as the tap", () => {
  it("pressed, ringed and named for a screen reader, with the other five standing down, before anything is awaited", async () => {
    const svc = await openPicker();
    const { release } = holdCreateNote(svc);
    const row = rowOf("Meeting Notes");
    fireEvent.click(row);
    // Nothing has been awaited since the tap, and the store has not answered: this is what the
    // person sees while the note is made and opened.
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(within(row).getByRole("status", { name: "Opening" })).toHaveClass("spinner");
    expect(row.querySelector(".chev")).toBeNull();
    const others = allRows().filter((r) => r !== row);
    // The six templates plus the template pages (#115): every other row stands down.
    expect(others).toHaveLength(allRows().length - 1);
    for (const o of others) {
      expect(o).toHaveAttribute("aria-disabled", "true");
      expect(o).not.toHaveAttribute("aria-busy");
      expect(o).toHaveAttribute("tabindex", "-1");
      expect(o.querySelector(".chev")).not.toBeNull();
    }
    release();
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("still makes the note the template promises, and the next New Note is a fresh, idle picker", async () => {
    const svc = await openPicker();
    fireEvent.click(rowOf("Meeting Notes"));
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
    const made = await notesIn(svc);
    expect(made).toHaveLength(1);
    // The lock changed nothing about what is made: the meeting template's own blocks are in it.
    const note = (await svc.note(made[0]!.id))!;
    expect(note.title).toBe("Meeting Notes");
    expect(note.blocks.map((b) => b.text)).toEqual(expect.arrayContaining(["Agenda", "Decisions", "Action Items"]));
    // Back to the list and into the picker again: the lock was released with the screen change.
    fireEvent.click(screen.getByText("Notes", { selector: ".nav-back .back-pill-t" }));
    fireEvent.click(await screen.findByLabelText("New Note", {}, { timeout: 4000 }));
    await screen.findByText("Project Brief");
    expect(document.querySelector(".lib-row[aria-busy], .lib-row[aria-disabled]")).toBeNull();
    expect(document.querySelectorAll(".lib-row .chev")).toHaveLength(document.querySelectorAll(".lib-row").length);
    fireEvent.click(rowOf("Project Brief"));
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await notesIn(svc)).toHaveLength(2);
  });
});

describe("NotesFlow: a create that fails gives the picker back", () => {
  it("unlocks every row, says Couldn't Save, makes no note, and the next tap is a fresh try", async () => {
    const svc = await openPicker();
    let fail!: (e: Error) => void;
    vi.spyOn(svc, "createNote").mockImplementationOnce(() => new Promise<string | null>((_, rej) => { fail = rej; }));
    const row = rowOf("Meeting Notes");
    fireEvent.click(row);
    expect(row, "busy while the write is out").toHaveAttribute("aria-busy", "true");
    await act(async () => { fail(new Error("offline")); });
    await waitFor(() => expect(said).toContain(WRITE_FAILED_MESSAGE));
    await waitFor(() => expect(row).not.toHaveAttribute("aria-busy"));
    expect(document.querySelector(".lib-row[aria-disabled]"), "no row is left unavailable").toBeNull();
    expect(document.querySelectorAll(".lib-row .chev")).toHaveLength(document.querySelectorAll(".lib-row").length);
    expect(row.querySelector(".spinner")).toBeNull();
    // Still the picker, still no note.
    expect(screen.queryByLabelText("Note")).toBeNull();
    expect(await notesIn(svc)).toHaveLength(0);
    fireEvent.click(row);
    expect(await screen.findByLabelText("Note", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(await notesIn(svc)).toHaveLength(1);
  });
});

describe("NotesFlow: walking away from a create in flight", () => {
  it("Back while the note is being made is live, and the person is not pulled into an editor they left", async () => {
    const svc = await openPicker();
    const { release } = holdCreateNote(svc);
    fireEvent.click(rowOf("Meeting Notes"));
    // Back is never locked.
    fireEvent.click(screen.getByText("Notes", { selector: ".nav-back .back-pill-t" }));
    expect(await screen.findByLabelText("New Note", {}, { timeout: 4000 })).toBeInTheDocument();
    release();
    // The note is made, the list says so, and the person is still on the list.
    await waitFor(async () => expect(await notesIn(svc)).toHaveLength(1), { timeout: 4000 });
    expect(await screen.findByText("Meeting Notes", {}, { timeout: 4000 })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(screen.queryByLabelText("Note"), "no late jump into the editor").toBeNull();
    expect(screen.getByLabelText("New Note")).toBeInTheDocument();
    // The lock went with the create: the picker is idle the next time it opens.
    fireEvent.click(screen.getByLabelText("New Note"));
    await screen.findByText("Project Brief");
    expect(document.querySelector(".lib-row[aria-busy], .lib-row[aria-disabled]")).toBeNull();
  });

  it("a link into another note while the create is out keeps that note on screen", async () => {
    function ShellLike({ id }: { id: string }) {
      const [intent, setIntent] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
      return (
        <>
          <button onClick={() => setIntent((i) => ({ value: id, nonce: i.nonce + 1 }))}>Open It</button>
          <NotesFlow openId={intent.value} openNonce={intent.nonce} onOpenConsumed={() => setIntent((i) => ({ nonce: i.nonce }))} />
        </>
      );
    }
    const svc = await openPicker((otherId) => <ShellLike id={otherId} />);
    const { release } = holdCreateNote(svc);
    fireEvent.click(rowOf("Meeting Notes"));
    fireEvent.click(screen.getByText("Open It"));
    await waitFor(() => expect(document.querySelector(".doc-title")).toHaveTextContent("Other Note"), { timeout: 4000 });
    release();
    await waitFor(async () => expect(await notesIn(svc)).toHaveLength(2), { timeout: 4000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    // The note they asked to read is still the one on screen, not replaced by the late create.
    expect(document.querySelector(".doc-title")).toHaveTextContent("Other Note");
  });
});
