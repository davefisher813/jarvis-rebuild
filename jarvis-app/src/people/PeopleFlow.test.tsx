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
