// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ContextPromptCard from "./ContextPromptCard";
import type { TaskItem } from "../TasksService";

// THE CONTEXT PROMPT (push D): a card with the verb, Continue Anyway and a
// day's snooze. Never a gate: nothing is disabled, nothing is modal.
const item = (linked: boolean): TaskItem => ({
  id: "r1",
  data: { text: "Do Bridge work before Jarvis", category: "c1", done: false, reminder: { time: "09:00", scheduleKind: "unscheduled", contextTrigger: { kind: "onOpenArea", targetId: "c2", cooldownMinutes: 240, lastShownAt: null }, ...(linked ? { linkedItem: { type: "task", id: "t1", label: "Bridge Priorities" } } : {}) } },
} as TaskItem);

describe("ContextPromptCard", () => {
  it("offers the verb for the linked record, Continue Anyway and Snooze This Prompt", () => {
    const onOpenLinked = vi.fn(); const onContinue = vi.fn(); const onSnooze = vi.fn();
    render(<ContextPromptCard item={item(true)} onOpenLinked={onOpenLinked} onContinue={onContinue} onSnooze={onSnooze} />);
    expect(screen.getByText("Do Bridge work before Jarvis")).toBeInTheDocument();
    expect(screen.getByText(/About Bridge Priorities/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Task"));
    expect(onOpenLinked).toHaveBeenCalledWith({ type: "task", id: "t1", label: "Bridge Priorities" });
    fireEvent.click(screen.getByText("Continue Anyway"));
    expect(onContinue).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByText("Snooze This Prompt"));
    expect(onSnooze).toHaveBeenCalledWith("r1");
  });
  it("with no linked record there is no verb, and the words still carry", () => {
    render(<ContextPromptCard item={item(false)} onContinue={() => {}} onSnooze={() => {}} />);
    expect(screen.queryByText("Open Task")).toBeNull();
    expect(screen.getByText("Continue Anyway")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
