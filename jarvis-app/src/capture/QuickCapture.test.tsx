// @vitest-environment jsdom
// SPEC MOVED (2026-08-15, Smart Paste, addendum item 1): capture no longer
// previews and asks for a confirm tap. It saves INSTANTLY and offers
// post-action correction (refile chips, undo) on the receipt. These tests
// replaced the old preview-flow tests deliberately; the old behavior was not
// broken, it was retired.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useOptionalStrands } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";

// S4-Q22 (2026-09-04) needs to see the honest "Brain is full" toast text,
// which the earlier tests in this file never had to inspect. Same mock shape
// as ProfilePage.test.tsx: a captured fn standing in for the real module.
const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

beforeEach(() => localStorage.clear());

let strandsRef: ReturnType<typeof useOptionalStrands> | null = null;
function CaptureStrands() {
  strandsRef = useOptionalStrands();
  return null;
}

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

// S4-Q22 (2026-09-04): selfFact.ts has always said "the receipt renders the
// category with chips to change it, same as every other capture" -- these
// prove that sentence is now true. No prior test file touched the fact
// lane's category chips at all.
describe("QuickCapture fact category chips (S4-Q22)", () => {
  beforeEach(() => { showToast.mockReset(); strandsRef = null; });

  it("offers the strand's six buckets, with the guessed one already active", async () => {
    render(
      <NotesProvider userId="u-fact-buckets">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    // selfFact.ts's own example sentence: SHAPES matches "I never...", and the
    // weekday bucket (routine) matches before any other, since "Sundays" hits
    // no energy words first.
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    expect(screen.getByText("Fact · Routine · From your paste")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "false");
    for (const label of ["Energy", "Work Style", "Writing", "People", "Values", "Routine"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("tapping a different bucket moves the fact", async () => {
    render(
      <NotesProvider userId="u-fact-move">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "Energy" }));
    await waitFor(() => expect(screen.getByText("Fact · Energy · From your paste")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "false");
  });

  it("a full bucket refuses honestly, and the chip stays where it was", async () => {
    render(
      <NotesProvider userId="u-fact-full">
        <CaptureStrands />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(strandsRef).toBeTruthy());
    await act(async () => {
      for (let i = 0; i < 12; i++) await strandsRef!.add("v " + i, "energy", "2026-01-01");
    });

    fireEvent.change(screen.getByPlaceholderText(/Paste or type/), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "Energy" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "The Brain is full · Prune it in What JARVIS Knows" }));

    // The refusal moved nothing: the fact is still under Routine.
    expect(screen.getByText("Fact · Routine · From your paste")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "false");
  });
});
