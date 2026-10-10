// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import UploadFlow from "./UploadFlow";
import type { AIService } from "../ai/AIService";

// Read and Paste Text (Dave: pasting a workout from Apple Notes did
// nothing). This flow had zero test coverage, unlike its sibling upload
// flows (ScheduleUploadFlow, SyllabusUploadFlow, SeasonFeedScreen), which
// all exercise paste -> read -> review the same way. This file closes that
// gap and proves a real Apple Notes paste -- checklist glyphs, smart quotes,
// an en dash -- reaches the review screen once cleanPastedText runs ahead of
// the model.

const reply = (program: Record<string, unknown>) => JSON.stringify(program);

// A realistic Apple Notes checklist paste: the checkbox glyph Notes exports
// as plain text ahead of each line, a smart apostrophe, an en dash.
const APPLE_NOTES_PASTE = [
  "☐ Dave’s Push Day – heavy",
  "☐ Bench Press 3x8 135lb",
  "☐ Overhead Press 3x10",
].join("\n");

function fakeAI(text: string, captured: { content?: string } = {}): AIService {
  return {
    available: true,
    complete: async (messages: { role: string; content: string }[]) => {
      captured.content = messages[0]?.content;
      return text;
    },
  } as unknown as AIService;
}

describe("UploadFlow: Read and Paste Text", () => {
  it("reads a real Apple Notes paste (checklist glyphs, smart quotes, en dash) through to the review screen", async () => {
    const captured: { content?: string } = {};
    const ai = fakeAI(reply({
      name: "Push Day",
      days: [{ name: "Day 1", exercises: [
        { name: "Bench Press", kind: "weight_reps", unit: "lb", sets: 3, target: { w: 135, r: 8 } },
        { name: "Overhead Press", kind: "reps", sets: 3, target: { r: 10 } },
      ] }],
    }), captured);
    render(<UploadFlow ai={ai} onSave={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/Paste the Program/), { target: { value: APPLE_NOTES_PASTE } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));

    expect(await screen.findByText("What I Read · Fix Anything")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Overhead Press")).toBeInTheDocument();
    // The checklist glyph and smart punctuation never reached the model.
    expect(captured.content).toContain("Dave's Push Day - heavy");
    expect(captured.content).not.toMatch(/[☐’–]/);
  });

  it("shows a clear toast, not silence, when the model's reply cannot be read as a program", async () => {
    const ai = fakeAI("I couldn't make out a program in that.");
    render(<UploadFlow ai={ai} onSave={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste the Program/), { target: { value: "some notes" } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));
    expect(await screen.findByText("Read the Pasted Text")).toBeInTheDocument();
    // Still on the source-pick sheet, button is not stuck on "Reading...".
    expect(screen.queryByText("What I Read · Fix Anything")).not.toBeInTheDocument();
  });

  it("disables the button until there is something pasted", () => {
    render(<UploadFlow ai={fakeAI(reply({ days: [] }))} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Read the Pasted Text")).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Paste the Program/), { target: { value: "x" } });
    expect(screen.getByText("Read the Pasted Text")).toBeEnabled();
  });
});
