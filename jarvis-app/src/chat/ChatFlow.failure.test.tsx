// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useChat } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import type { AIService } from "../ai/AIService";
import { AIProviderError } from "../ai/providerFailure";
import { AIBudgetError } from "../ai/aiBudget";
import { AIUnavailableError } from "../ai/aiGate";

// THE THREAD SAYS WHAT IS ACTUALLY WRONG (Dave 2026-10-24). Every way the AI lane could fail used to produce one line,
// "Couldn't reach the AI · Try again". This drives a real question through the real ChatFlow with the AI call failing in each way
// and reads the thread: the cause, in words, and a Try Again only where trying again can work.

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const ai = vi.hoisted(() => ({ available: true, complete: vi.fn() }));
vi.mock("../ai/useAI", () => ({ useAI: () => ai as unknown as AIService }));
vi.mock("../shared/toast", () => ({ showToast: () => {} }));

// A question no records can answer, so it reaches the AI lane.
const Q = "What is the capital of France?";
const OLD_LINE = "Couldn't reach the AI · Try again";

let chatRef: ReturnType<typeof useChat> | null = null;
function Capture() { chatRef = useChat(); return null; }

function renderChat(userId: string) {
  render(<NotesProvider userId={userId}><Capture /><ChatFlow /></NotesProvider>);
}
async function ask(text: string) {
  fireEvent.change(await screen.findByPlaceholderText("Ask, Tell or Paste"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}
const tryAgain = () => screen.queryByRole("button", { name: "Try Again" });

beforeEach(() => { ai.complete.mockReset(); chatRef = null; });

describe("a failed AI turn names its cause", () => {
  it("an account out of credit says so and offers nothing to retry", async () => {
    ai.complete.mockRejectedValue(new AIProviderError("AI_PROVIDER_CREDIT"));
    renderChat("u-fail-credit");
    await ask(Q);
    expect(await screen.findByText("The AI provider account is out of credit · Add credit, then ask again")).toBeInTheDocument();
    expect(screen.queryByText(OLD_LINE)).toBeNull();
    expect(tryAgain()).toBeNull();
  });

  it("the spending limit speaks in its own words and offers nothing to retry", async () => {
    ai.complete.mockRejectedValue(new AIBudgetError({ code: "AI_BUDGET_REACHED", limitMicrousd: 5_000_000, remainingMicrousd: 0 }));
    renderChat("u-fail-budget");
    await ask(Q);
    expect(await screen.findByText("AI paused. You reached your $5 limit.")).toBeInTheDocument();
    expect(tryAgain()).toBeNull();
  });

  it("AI turned off says so, and that records and commands still work", async () => {
    ai.complete.mockRejectedValue(new AIUnavailableError("AI_OFF", "AI is turned off in Settings."));
    renderChat("u-fail-off");
    await ask(Q);
    expect(await screen.findByText("AI is turned off in Settings · I can still answer from your records and run commands")).toBeInTheDocument();
    expect(tryAgain()).toBeNull();
  });

  it("a dropped connection is a connection problem, and that one can be retried", async () => {
    ai.complete.mockRejectedValue(new TypeError("Failed to fetch"));
    renderChat("u-fail-net");
    await ask(Q);
    expect(await screen.findByText("Couldn't reach JARVIS · Check your connection, then try again")).toBeInTheDocument();
    expect(tryAgain()).not.toBeNull();
  });

  it("the failure is stored as a failure, not as something JARVIS said", async () => {
    ai.complete.mockRejectedValue(new AIProviderError("AI_PROVIDER_CREDIT"));
    renderChat("u-fail-kind");
    await ask(Q);
    await screen.findByText(/out of credit/);
    const stored = await chatRef!.list();
    expect(stored.map((m) => [m.data.role, m.data.provenance?.kind ?? null])).toEqual([["user", null], ["jarvis", "error"]]);
  });
});

describe("Try Again", () => {
  it("answers the same words again without a second copy of them in the thread", async () => {
    ai.complete.mockRejectedValueOnce(new AIProviderError("AI_PROVIDER_BUSY")).mockResolvedValueOnce("Paris.");
    renderChat("u-retry-ok");
    await ask(Q);
    expect(await screen.findByText("The AI provider isn't answering right now · Try again in a moment")).toBeInTheDocument();
    fireEvent.click(tryAgain()!);
    expect(await screen.findByText("Paris.")).toBeInTheDocument();
    expect(screen.getAllByText(Q)).toHaveLength(1);
    expect(tryAgain()).toBeNull();
    expect(ai.complete).toHaveBeenCalledTimes(2);
  });

  it("never sends the failure back to the model as part of the conversation", async () => {
    ai.complete.mockRejectedValueOnce(new AIProviderError("AI_PROVIDER_BUSY")).mockResolvedValueOnce("Paris.");
    renderChat("u-retry-ctx");
    await ask(Q);
    await screen.findByText(/isn't answering/);
    fireEvent.click(tryAgain()!);
    await screen.findByText("Paris.");
    expect(ai.complete.mock.calls[0]![0]).toEqual([{ role: "user", content: Q }]);
    expect(ai.complete.mock.calls[1]![0]).toEqual([{ role: "user", content: Q }]);
  });

  it("a second failure puts the cause in the thread again and keeps the chip", async () => {
    ai.complete.mockRejectedValue(new AIProviderError("AI_PROVIDER_BUSY"));
    renderChat("u-retry-twice");
    await ask(Q);
    await screen.findByText(/isn't answering/);
    fireEvent.click(tryAgain()!);
    await waitFor(() => expect(screen.getAllByText("The AI provider isn't answering right now · Try again in a moment")).toHaveLength(2));
    expect(tryAgain()).not.toBeNull();
  });

  it("a new message in the box retires the chip", async () => {
    ai.complete.mockRejectedValueOnce(new AIProviderError("AI_PROVIDER_BUSY")).mockResolvedValueOnce("Paris.");
    renderChat("u-retry-new");
    await ask(Q);
    await screen.findByText(/isn't answering/);
    expect(tryAgain()).not.toBeNull();
    await ask("What is the capital of Spain?");
    await screen.findByText("Paris.");
    expect(tryAgain()).toBeNull();
  });
});
