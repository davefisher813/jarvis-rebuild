// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import ProjectsFlow from "./ProjectsFlow";

describe("ProjectsFlow", () => {
  it("empty -> add a project -> appears with status", async () => {
    render(<NotesProvider userId="u1"><ProjectsFlow /></NotesProvider>);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add a Project"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Q3 launch plan"), { target: { value: "Kitchen remodel" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Kitchen remodel")).toBeInTheDocument());
  });
});
