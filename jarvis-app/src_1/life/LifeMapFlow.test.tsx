// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import LifeMapFlow from "./LifeMapFlow";

describe("LifeMapFlow", () => {
  it("empty -> add an area -> it appears with its state", async () => {
    render(<NotesProvider userId="u1"><LifeMapFlow /></NotesProvider>);
    expect(await screen.findByText("Map the areas of your life")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add an Area"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Health"), { target: { value: "Health" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Health")).toBeInTheDocument());
    expect(screen.getByText("Active Goals")).toBeInTheDocument();
  });
});
