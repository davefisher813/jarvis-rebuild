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
    fireEvent.click(screen.getByText("Add Category"));
    expect(screen.getByText("New Category")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Category name"), { target: { value: "Travel" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Travel")).toBeInTheDocument());
  });
});
