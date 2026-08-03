// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import MoneyFlow from "./MoneyFlow";

describe("MoneyFlow", () => {
  it("empty -> add account -> shows total, dated as self-reported", async () => {
    render(<NotesProvider userId="u1"><MoneyFlow /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add an Account"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Checking"), { target: { value: "Savings" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "5000" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Total balance")).toBeInTheDocument());
    expect(screen.getAllByText("$5,000").length).toBeGreaterThanOrEqual(2);
    // The balance is self-reported and the page says so, with a date.
    expect(screen.getByText(/As you last entered it ·/)).toBeInTheDocument();
  });

  it("adds a bill and marks it paid with a dated receipt; autopay copy never says paid", async () => {
    render(<NotesProvider userId="u2"><MoneyFlow /></NotesProvider>);
    // From empty: the bill path exists without an account
    fireEvent.click(await screen.findByText("Add a Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Electric" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "120" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Electric")).toBeInTheDocument());
    expect(screen.getByText("$120")).toBeInTheDocument();
    // mark paid -> dated receipt appears
    fireEvent.click(screen.getByLabelText("Mark paid"));
    await waitFor(() => expect(screen.getByText(/^Paid /)).toBeInTheDocument());

    // autopay bill: only ever "set to autopay" language
    fireEvent.click(screen.getByText("Add Bill"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Rent"), { target: { value: "Rent" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1850" } });
    fireEvent.click(screen.getByText("It pays itself"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Rent")).toBeInTheDocument());
    expect(screen.getByText(/Set to autopay/)).toBeInTheDocument();
    expect(screen.queryByText(/Rent.*paid/i)).not.toBeInTheDocument();
  });
});
