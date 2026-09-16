// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import PeopleFlow from "./PeopleFlow";

// The toast renders through a host this harness does not mount, so the call
// itself is what gets asserted. That is the part under test anyway: whether
// the delete announces itself and hands back a way out.
const toasts: { message: string; actionLabel?: string; onAction?: () => void }[] = [];
vi.mock("../shared/toast", () => ({
  showToast: (t: { message: string; actionLabel?: string; onAction?: () => void }) => { toasts.push(t); },
}));

describe("PeopleFlow", () => {
  it("starts empty, then adds a person who appears in the list", async () => {
    render(
      <NotesProvider userId="u1">
        <PeopleFlow onBack={() => {}} />
      </NotesProvider>,
    );
    expect(screen.getByText("No One Here Yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add Person"));
    expect(screen.getByText(/New Person/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Sam Rivera" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Sam Rivera")).toBeInTheDocument());
  });

  // B10 (2026-08-23): this was the worst case in the button audit. Deleting a
  // person removed the contact and every fact recorded about them with no
  // guard, no toast, and no undo. The row simply stopped existing.
  it("deleting a person says so and hands back the way to undo it", async () => {
    render(
      <NotesProvider userId="u2">
        <PeopleFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(screen.getByText("Add Person"));
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Sam Rivera" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Sam Rivera")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Sam Rivera"));
    fireEvent.click(await screen.findByLabelText("Edit"));
    fireEvent.click(await screen.findByText("Delete Person"));

    await waitFor(() => expect(screen.queryByText("Sam Rivera")).not.toBeInTheDocument());

    // The two things that were missing entirely: it says what happened, and
    // it offers the way back.
    const last = toasts[toasts.length - 1]!;
    expect(last.message).toBe("Sam Rivera deleted");
    expect(last.actionLabel).toBe("Undo");

    last.onAction!();
    await waitFor(() => expect(screen.getByText("Sam Rivera")).toBeInTheDocument());
  });
});

// BRAIN-F-09 (2026-09-05): the sheet's Save latches on the first tap (B12),
// but this parent's write had no guard: offline, people.create threw, the
// latch never let go, and the button read "Saving" forever with Cancel, which
// throws the edit away, as the only way out.
import { usePeople } from "../data/NotesProvider";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

let peopleRef: ReturnType<typeof usePeople> | null = null;
function CapturePeople() {
  peopleRef = usePeople();
  return null;
}

describe("PeopleFlow save guard (BRAIN-F-09)", () => {
  it("a failed save says so, keeps the sheet open, and lets go of the button", async () => {
    render(
      <NotesProvider userId="u-f09">
        <CapturePeople />
        <PeopleFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(screen.getByText("Add Person"));
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Ana Diaz" } });
    peopleRef!.create = () => Promise.reject(new Error("offline"));
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(toasts.map((t) => t.message)).toContain(WRITE_FAILED_MESSAGE));
    // Still open, still holding what was typed, and tappable again.
    expect(screen.getByDisplayValue("Ana Diaz")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
    expect(screen.queryByText("Saving")).not.toBeInTheDocument();
    // Nobody is in the list: the failure did not half-close over a person
    // who was never written.
    expect(screen.queryByText("Ana Diaz")).not.toBeInTheDocument();
  });
});

// BRAIN-F-13 (2026-09-05): Undo recreated the person under a NEW id, so the
// card came back with Linked Notes empty and any decision attached to them
// showing no attachment: both link by person id.
import { useNotes } from "../data/NotesProvider";

let notesRef: ReturnType<typeof useNotes> | null = null;
function CaptureNotes() {
  notesRef = useNotes();
  peopleRef = usePeople();
  return null;
}

describe("PeopleFlow delete undo (BRAIN-F-13)", () => {
  it("restores the person under their own id, so linked notes still point at them", async () => {
    render(
      <NotesProvider userId="u-f13">
        <CaptureNotes />
        <PeopleFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(screen.getByText("Add Person"));
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: "Marco Vidal" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Marco Vidal")).toBeInTheDocument());

    const personId = (await peopleRef!.list())[0]!.id;
    const noteId = (await notesRef!.createNote("Call with Marco", ""))!;
    await notesRef!.addConnection(noteId, "person", "Marco Vidal", personId);
    expect(await notesRef!.notesLinkedTo(personId)).toHaveLength(1);

    fireEvent.click(screen.getByText("Marco Vidal"));
    fireEvent.click(await screen.findByLabelText("Edit"));
    fireEvent.click(await screen.findByText("Delete Person"));
    await waitFor(() => expect(screen.queryByText("Marco Vidal")).not.toBeInTheDocument());

    toasts[toasts.length - 1]!.onAction!();
    await waitFor(() => expect(screen.getByText("Marco Vidal")).toBeInTheDocument());
    const back = await peopleRef!.list();
    expect(back).toHaveLength(1);
    expect(back[0]!.id).toBe(personId);
    expect(await notesRef!.notesLinkedTo(personId)).toHaveLength(1);
  });
});

// THE NUMBER ALREADY SITTING IN THE NOTES (People handoff, 2026-09-16; the
// contact Dave photographed had one, with the Phone field blank beside it).
//
// The harness adds the person through the sheet, the way the other tests in
// this file do, so the note goes in the way a real one would.
describe("repairing contact details out of the notes", () => {
  const withNote = async (uid: string, name: string, note: string) => {
    render(
      <NotesProvider userId={uid}>
        <PeopleFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(screen.getByText("Add Person"));
    fireEvent.change(screen.getByPlaceholderText("Full Name"), { target: { value: name } });
    const notes = screen.getByLabelText("Notes");
    fireEvent.change(notes, { target: { value: note } });
    fireEvent.click(screen.getByText("Save"));
    // The name can appear twice once a repair is on offer: the list row and
    // the offer row above it.
    await waitFor(() => expect(screen.getAllByText(name).length).toBeGreaterThan(0));
  };

  it("offers what it found, with the line it came from, and applies nothing on its own", async () => {
    await withNote("r1", "Aaron Roman", "Cell 555-010-3311, call after 6");
    // The value and the line are both on screen, so "is this a number?" can
    // actually be answered rather than assumed.
    expect(await screen.findByText("555-010-3311")).toBeInTheDocument();
    expect(screen.getByText("Cell 555-010-3311, call after 6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "It's a number" })).toBeInTheDocument();
  });

  it("fills the field on confirmation, and the note survives it", async () => {
    await withNote("r2", "Aaron Roman", "Cell 555-010-3311, call after 6");
    fireEvent.click(await screen.findByRole("button", { name: "It's a number" }));
    // The offer is gone because the number is now on the record, which is
    // what makes it no longer a finding.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "It's a number" })).not.toBeInTheDocument();
    });
    // It says what it did and hands back the way out.
    const last = toasts[toasts.length - 1]!;
    expect(last.message).toBe("Number moved to Aaron Roman");
    expect(last.actionLabel).toBe("Undo");
    // THE NOTE IS KEPT: open the person and the sentence is still there.
    fireEvent.click(screen.getAllByText("Aaron Roman")[0]!);
    expect(await screen.findByText("Cell 555-010-3311, call after 6")).toBeInTheDocument();
  });

  it("stops asking once you say it is not a number", async () => {
    await withNote("r3", "Aaron Roman", "Order 5550103311 still open. Cell 555-010-9922");
    fireEvent.click(await screen.findByRole("button", { name: "Not One" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "It's a number" })).not.toBeInTheDocument();
    });
  });

  it("says nothing about a contact whose notes hold no contact details", async () => {
    await withNote("r4", "Lee Ramos", "Met at the clinic in 2019");
    expect(screen.queryByRole("button", { name: "It's a number" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Not One" })).not.toBeInTheDocument();
  });
});
