// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
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
});
