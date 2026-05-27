// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import InsightsFlow from "./InsightsFlow";

describe("InsightsFlow", () => {
  it("shows empty state with no data", async () => {
    render(<NotesProvider userId="u1"><InsightsFlow /></NotesProvider>);
    expect(await screen.findByText("Nothing to chart yet")).toBeInTheDocument();
  });
});
