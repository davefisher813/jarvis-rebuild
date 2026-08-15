// @vitest-environment jsdom
// SPEC MOVED (2026-08-15, Smart Paste, addendum item 1): capture no longer
// previews and asks for a confirm tap. It saves INSTANTLY and offers
// post-action correction (refile chips, undo) on the receipt. These tests
// replaced the old preview-flow tests deliberately; the old behavior was not
// broken, it was retired.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";

beforeEach(() => localStorage.clear());

describe("QuickCapture (Smart Paste)", () => {
  it("saves instantly with no AI in the build and shows the receipt with refile chips", async () => {
    const onClose = vi.fn();
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    // Instant save: the receipt appears without any confirm step.
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("Renew the Domain")).toBeInTheDocument();
    expect(screen.getByText("Undo")).toBeInTheDocument();
    // The kind chips are present for post-action correction.
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("Event")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("asks the AI only for unconfident text and saves its answer instantly", async () => {
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
    // "standup tomorrow": a date with no time and no imperative opener is
    // the deterministic layer's unconfident case, so the AI gets a say.
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "standup tomorrow" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a confident paste never calls the AI at all", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: "{}" }), text: async () => "" })) as unknown as typeof fetch;
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: true, getToken: () => "tok", fetchImpl })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the exact same paste within 7 days is flagged, with Save Anyway as the override", async () => {
    const ai = new AIService({ available: false });
    const { unmount } = render(
      <NotesProvider userId="u1">
        <QuickCapture ai={ai} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    unmount();

    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={ai} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText(/You captured this exact text/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save Anyway"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
});
