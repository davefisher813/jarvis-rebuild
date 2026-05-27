// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import MoneyFlow from "./MoneyFlow";

describe("MoneyFlow", () => {
  it("empty -> add account -> shows total", async () => {
    render(<NotesProvider userId="u1"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add an Account"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Checking"), { target: { value: "Savings" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Total balance")).toBeInTheDocument());
    expect(screen.getAllByText("$5,000").length).toBeGreaterThanOrEqual(2);
  });
});
