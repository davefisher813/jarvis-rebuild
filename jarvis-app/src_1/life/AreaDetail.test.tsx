// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useAreas } from "../data/NotesProvider";
import LifeMapFlow from "./LifeMapFlow";
import { useEffect } from "react";

function Seed() { const a = useAreas(); useEffect(() => { void a.create({ name: "Health", state: "steady" }); }, [a]); return null; }

describe("Area detail", () => {
  it("tapping an area opens its detail screen with an Edit action", async () => {
    render(<NotesProvider userId="u1"><Seed /><LifeMapFlow /></NotesProvider>);
    const area = await screen.findByText("Health");
    fireEvent.click(area.closest(".lm-row")!);
    await waitFor(() => expect(screen.getByText("Goals in this area")).toBeInTheDocument());
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });
});
