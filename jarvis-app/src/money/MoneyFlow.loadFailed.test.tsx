// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { MoneyService } from "./MoneyService";
import MoneyFlow from "./MoneyFlow";

// THE FIRST LOAD FAILED (research standard, section 5 rule 18, 2026-10-19). The Money overview told a person with accounts "No Accounts Yet" when its
// first read failed. It says what could not be read and offers Retry, the one filled primary; Retry reads again.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Money: the first load failing", () => {
  it("draws Couldn't Load Your Money with Retry instead of No Accounts Yet, and Retry reads again", async () => {
    vi.spyOn(MoneyService.prototype, "list").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="money-load-fail"><MoneyFlow /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load Your Money")).toBeInTheDocument();
    expect(document.querySelector(".empty-state .btn-primary")).toHaveTextContent("Retry");
    expect(screen.queryByText("No Accounts Yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No Accounts Yet")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't Load Your Money")).toBeNull();
  });

  it("a healthy first load never draws it", async () => {
    render(<NotesProvider userId="money-load-ok"><MoneyFlow /></NotesProvider>);
    expect(await screen.findByText("No Accounts Yet")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Couldn't Load Your Money")).toBeNull());
  });
});
