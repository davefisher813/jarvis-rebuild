// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import TodaySuggestions from "./TodaySuggestions";
import { emit, eventLog } from "../events";

// "JARVIS Noticed": at most ONE row, never echoing a visible Up Next task.

describe("TodaySuggestions", () => {
  it("renders nothing when AI is off and no pattern exists", () => {
    render(<NotesProvider userId="u1"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    expect(screen.queryByText("JARVIS Noticed")).not.toBeInTheDocument();
  });

  it("shows exactly one AI row, dismissible from the header", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: '["Email Sam the Q3 plan","Reach out to Maya"]' }),
      text: async () => "",
    })) as unknown as typeof fetch;
    render(<NotesProvider userId="u2"><TodaySuggestions ai={new AIService({ available: true, getToken: () => "t", fetchImpl })} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Email Sam the Q3 plan")).toBeInTheDocument());
    expect(screen.getByText("JARVIS Noticed")).toBeInTheDocument();
    // one row at a time: the second suggestion waits its turn
    expect(screen.queryByText("Reach out to Maya")).not.toBeInTheDocument();
    // dismissing from the header reveals the next candidate
    fireEvent.click(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(screen.queryByText("Email Sam the Q3 plan")).not.toBeInTheDocument());
  });
});

describe("TodaySuggestions planning pattern (Brain Personalization Phase 2, 2026-08-06)", () => {
  beforeEach(() => { eventLog.clear(); });

  it("surfaces a real duration-correction pattern, and Remember This clears it", async () => {
    for (let i = 0; i < 3; i++) {
      emit({ type: "plan.duration_corrected", entityType: "task", entityId: `t${i}`, props: { category: "work", n: 20 } });
    }
    render(<NotesProvider userId="u3"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("JARVIS Noticed")).toBeInTheDocument());
    expect(screen.getByText(/Your work tasks have been taking about 20 minutes longer/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Remember This"));
    await waitFor(() => expect(screen.queryByText(/Your work tasks/)).not.toBeInTheDocument());
  });

  it("shows nothing from a single correction, not enough evidence for a pattern", () => {
    emit({ type: "plan.duration_corrected", entityType: "task", entityId: "t1", props: { category: "work", n: 20 } });
    render(<NotesProvider userId="u4"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    expect(screen.queryByText("JARVIS Noticed")).not.toBeInTheDocument();
  });
});
