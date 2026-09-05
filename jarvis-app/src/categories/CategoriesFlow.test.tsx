// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { CategoriesService } from "./CategoriesService";
import { subscribeToast } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import CategoriesFlow from "./CategoriesFlow";

describe("CategoriesFlow", () => {
  it("adds a category end to end", async () => {
    render(
      <NotesProvider userId="u1">
        <CategoriesFlow onBack={() => {}} />
      </NotesProvider>,
    );
    fireEvent.click(screen.getByText("Add Area"));
    expect(screen.getByText("New Area")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Area Name"), { target: { value: "Travel" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Travel")).toBeInTheDocument());
  });

  // SHELL-F-01 (2026-09-05): deleting an area with two or more left used to
  // replace the More tab with the error card. ReorderList kept its previous
  // order until an effect resynced it, so the page's renderRow was called
  // once with the dead id and dereferenced undefined. Three areas, delete
  // the middle one, the other two stay on screen and nothing throws.
  it("deletes an area with others remaining without crashing the page", async () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errors.push(a); };
    try {
      render(
        <NotesProvider userId="u1">
          <CategoriesFlow onBack={() => {}} />
        </NotesProvider>,
      );
      for (const n of ["Alpha", "Beta", "Gamma"]) {
        fireEvent.click(screen.getByText("Add Area"));
        fireEvent.change(screen.getByPlaceholderText("Area Name"), { target: { value: n } });
        fireEvent.click(screen.getByText("Save"));
        await waitFor(() => expect(screen.getByText(n)).toBeInTheDocument());
      }
      fireEvent.click(screen.getByText("Beta"));
      await waitFor(() => expect(screen.getByText("Delete Category")).toBeInTheDocument());
      fireEvent.click(screen.getByText("Delete Category"));
      fireEvent.click(screen.getByText("Tap Again to Delete"));
      await waitFor(() => expect(screen.queryByText("Edit Area")).not.toBeInTheDocument());
      await waitFor(() => expect(screen.queryByText("Beta")).not.toBeInTheDocument());
    } finally {
      console.error = orig;
    }
    const crash = errors.flat().map(String).find((s) => /Cannot read properties of undefined|TypeError/.test(s));
    expect(crash).toBeUndefined();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  // SHELL-F-11 (2026-09-05): onSave had no guard at all, so a failed write
  // left the button reading "Saving" forever, no toast, and every further
  // tap swallowed by the double-tap latch. Cancel was the only way out and
  // it took the typed name with it.
  describe("when the write fails", () => {
    afterEach(() => vi.restoreAllMocks());

    it("says so, keeps the sheet and the typed name, and lets you try again", async () => {
      const seen: string[] = [];
      const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
      const create = vi.spyOn(CategoriesService.prototype, "create").mockRejectedValue(new Error("network"));
      render(
        <NotesProvider userId="u1">
          <CategoriesFlow onBack={() => {}} />
        </NotesProvider>,
      );
      fireEvent.click(screen.getByText("Add Area"));
      fireEvent.change(screen.getByPlaceholderText("Area Name"), { target: { value: "Travel" } });
      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
      // Still open, still holding the edit, and the button is a button again.
      expect(screen.getByDisplayValue("Travel")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());

      // The same tap, with the write no longer failing, goes through.
      create.mockRestore();
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() => expect(screen.getByText("Travel")).toBeInTheDocument());
      stop();
    });
  });
});
