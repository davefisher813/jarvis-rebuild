// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProjects } from "../data/NotesProvider";
import ProjectsFlow from "./ProjectsFlow";
import { useEffect } from "react";

function Seed() { const p = useProjects(); useEffect(() => { void p.create({ title: "Kitchen remodel", status: "active" }); }, [p]); return null; }

describe("Project detail", () => {
  it("tapping a project opens its detail with an Edit action", async () => {
    render(<NotesProvider userId="u1"><Seed /><ProjectsFlow /></NotesProvider>);
    const row = await screen.findByText("Kitchen remodel");
    fireEvent.click(row.closest(".proj-row")!);
    await waitFor(() => expect(screen.getByText("Details")).toBeInTheDocument());
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });
});
