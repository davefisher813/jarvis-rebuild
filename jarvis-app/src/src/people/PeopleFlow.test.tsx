// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import PeopleFlow from "./PeopleFlow";

describe("PeopleFlow", () => {
  it("starts empty, then adds a person who appears in the list", async () => {
    render(
      <NotesProvider userId="u1">
        <PeopleFlow group="inner_circle" onBack={() => {}} />
      </NotesProvider>,
    );
    expect(screen.getByText("No one here yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add Person"));
    expect(screen.getByText(/New Person/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Sam Rivera" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Sam Rivera")).toBeInTheDocument());
  });
});
