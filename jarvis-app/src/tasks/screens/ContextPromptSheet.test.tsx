// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ContextPromptSheet from "./ContextPromptSheet";
import type { TaskItem } from "../TasksService";

// THE CONTEXT PROMPT (push E): a sheet with the verb, Continue Anyway,
// Snooze Prompt and Turn Off. Never a gate: the scrim itself continues.
const item = (linked: boolean): TaskItem => ({
  id: "r1",
  data: { text: "Do Bridge work before Jarvis", category: "c1", done: false, reminder: { time: "09:00", scheduleKind: "unscheduled", contextTrigger: { kind: "onOpenArea", targetId: "c2", cooldownMinutes: 240, lastShownAt: null }, ...(linked ? { linkedItem: { type: "task", id: "t1", label: "Bridge Priorities" } } : {}) } },
} as TaskItem);

describe("ContextPromptSheet", () => {
  it("offers the verb, Continue Anyway, Snooze Prompt and Turn Off", () => {
    const onOpenLinked = vi.fn(); const onContinue = vi.fn(); const onSnooze = vi.fn(); const onTurnOff = vi.fn();
    render(<ContextPromptSheet item={item(true)} eyebrow="Opening Jarvis" onOpenLinked={onOpenLinked} onContinue={onContinue} onSnooze={onSnooze} onTurnOff={onTurnOff} />);
    expect(screen.getByText("Opening Jarvis")).toBeInTheDocument();
    expect(screen.getByText("Do Bridge work before Jarvis")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Open Task"));
    expect(onOpenLinked).toHaveBeenCalledWith({ type: "task", id: "t1", label: "Bridge Priorities" });
    expect(onContinue).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByText("Snooze Prompt"));
    expect(onSnooze).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByText("Turn Off"));
    expect(onTurnOff).toHaveBeenCalledWith("r1");
    fireEvent.click(screen.getByText("Continue Anyway"));
    expect(onContinue).toHaveBeenCalledTimes(2);
  });
  it("with no linked record there is no verb, and the words still carry", () => {
    const onContinue = vi.fn();
    render(<ContextPromptSheet item={item(false)} eyebrow="After Completing a Task" onContinue={onContinue} onSnooze={() => {}} onTurnOff={() => {}} />);
    expect(screen.queryByText("Open Task")).toBeNull();
    expect(screen.getByText("Continue Anyway")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
