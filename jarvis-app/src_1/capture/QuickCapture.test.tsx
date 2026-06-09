// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";

describe("QuickCapture", () => {
  it("uses the local fallback when AI is off, previews, and files", async () => {
    const onClose = vi.fn();
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Lunch with Sam/), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Task")).toBeInTheDocument());
    expect(screen.getByText("Renew the domain")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add Task"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("uses the AI parse when available", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: '{"kind":"event","title":"Standup","start":"09:00"}' }),
      text: async () => "",
    })) as unknown as typeof fetch;
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: true, getToken: () => "tok", fetchImpl })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Lunch with Sam/), { target: { value: "standup tomorrow" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Event")).toBeInTheDocument());
    expect(screen.getByText("Standup")).toBeInTheDocument();
  });
});
