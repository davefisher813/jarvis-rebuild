// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import TodaySuggestions from "./TodaySuggestions";

describe("TodaySuggestions", () => {
  it("renders nothing when AI is off", () => {
    render(<NotesProvider userId="u1"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    expect(screen.queryByText("JARVIS Suggestions")).not.toBeInTheDocument();
  });

  it("shows AI suggestions and dismisses on tap", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: '["Email Sam the Q3 plan","Reach out to Maya"]' }),
      text: async () => "",
    })) as unknown as typeof fetch;
    render(<NotesProvider userId="u1"><TodaySuggestions ai={new AIService({ available: true, getToken: () => "t", fetchImpl })} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Email Sam the Q3 plan")).toBeInTheDocument());
    expect(screen.getByText("JARVIS Suggestions")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Email Sam the Q3 plan"));
    await waitFor(() => expect(screen.queryByText("Email Sam the Q3 plan")).not.toBeInTheDocument());
  });
});
