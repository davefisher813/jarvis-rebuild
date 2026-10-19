// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";

// THE LIVE READ UNDER THE BOX (research standard, rule 12, 2026-10-19): the facts the receipt will draw, while the line is typed, and nothing at all
// when nothing is read.
beforeEach(() => localStorage.clear());

const open = () => {
  render(<NotesProvider userId="live-read"><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} /></NotesProvider>);
  return screen.getByLabelText("Paste or Type");
};
const live = () => document.querySelector(".live-read");

describe("QuickCapture: the live read", () => {
  it("draws what the line reads as facts, under the aids, and nothing for a plain task", async () => {
    const box = open();
    fireEvent.change(box, { target: { value: "Dentist at 3pm" } });
    await waitFor(() => expect(live()).toBeInTheDocument());
    const facts = [...live()!.querySelectorAll(".fact")].map((f) => f.textContent);
    expect(facts[0]).toBe("Event");
    expect(facts).toContain("3:00 PM");
    // Facts, not a string with dots in it (§AM F3): the dot is the stylesheet's.
    expect(live()!.textContent).not.toContain("·");
    // Under the aids, so the Speak button never moves while the line is typed.
    const aids = document.querySelector(".msg-quiet-acts")!;
    expect(aids.compareDocumentPosition(live()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(box, { target: { value: "Call the dentist" } });
    await waitFor(() => expect(live()).toBeNull());
  });

  it("says how many a multi-line paste will make", async () => {
    const box = open();
    fireEvent.change(box, { target: { value: "Lunch\nCall mom\nBuy milk" } });
    expect(await screen.findByText("3 Items")).toBeInTheDocument();
  });

  it("an amount is read as a bill, and the line clears with the box once it is saved", async () => {
    const box = open();
    fireEvent.change(box, { target: { value: "Pay electric bill $85 friday" } });
    await waitFor(() => expect(live()?.textContent).toContain("Bill"));
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(live()).toBeNull();
  });
});
