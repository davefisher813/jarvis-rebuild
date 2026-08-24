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
