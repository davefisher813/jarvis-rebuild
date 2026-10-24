// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProposalCards from "./ProposalCards";
import type { Proposal, ProposalContent, ProposalState } from "./proposals";

// THE CARDS IN THE THREAD (chat box order, 2026-10-24): the exact content, whole, in a JARVIS bubble; the chips that act on it outside the
// bubble. The catalog is checked on the DOM: no dots baked into the words, no pill inside a card, Title Case controls.

const addTask: ProposalContent = { kind: "create_task", text: "Call the plumber about the leak under the kitchen sink and the second bathroom", due: "2026-10-30", priority: "high", personId: "m1", personName: "Marco" };
const moveTask: ProposalContent = {
  kind: "update_task", taskId: "t1", title: "Call the plumber",
  basis: { text: "Call the plumber", due: "2026-10-29", done: false, priority: null }, change: { due: "2026-10-30" },
};
const decision: ProposalContent = { kind: "capture_decision", decision: "Use Ridgeline for the roof", why: "Best warranty" };

const proposal = (content: ProposalContent, state: ProposalState = "open", id = "p1"): Proposal => ({
  id, tool: content.kind, content, hash: "h".repeat(64), createdAt: 0, expiresAt: 300_000, state,
});

function draw(proposals: Proposal[]) {
  const fns = { onApprove: vi.fn(), onCancel: vi.fn(), onDismiss: vi.fn() };
  const view = render(<ProposalCards proposals={proposals} {...fns} />);
  return { ...fns, ...view };
}

describe("an open card", () => {
  it("shows the question and the exact content, whole, one fact to a line", () => {
    const { container } = draw([proposal(addTask)]);
    const text = container.querySelector(".chat-text")!;
    expect(text.textContent).toBe(["Add this task?", addTask.kind === "create_task" ? addTask.text : "", "Due Fri, Oct 30", "High Priority", "About Marco"].join("\n"));
    expect(screen.getByRole("group", { name: "Proposed Change" })).toBeInTheDocument();
  });

  it("names the change for what it does, and offers Not Now beside it", () => {
    draw([proposal(addTask, "open", "a"), proposal(moveTask, "open", "b"), proposal(decision, "open", "c")]);
    for (const name of ["Add Task", "Move Task", "Save Decision"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Not Now" })).toHaveLength(3);
  });

  it("a tap reports which card, and does nothing else", () => {
    const { onApprove, onCancel, onDismiss } = draw([proposal(moveTask)]);
    fireEvent.click(screen.getByRole("button", { name: "Move Task" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove.mock.calls[0]![0]).toMatchObject({ id: "p1" });
    fireEvent.click(screen.getByRole("button", { name: "Not Now" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps to the catalog: the words in a bubble, the actions as capsules outside it, no dot baked in, no facts line, no pill inside", () => {
    const { container } = draw([proposal(addTask), proposal(moveTask, "open", "b"), proposal(decision, "open", "c")]);
    expect(container.querySelectorAll(".chat-bubble.chat-jarvis")).toHaveLength(3);
    expect(container.querySelector(".facts, .fact")).toBeNull();
    for (const t of container.querySelectorAll(".chat-text")) expect(t.textContent).not.toContain("·");
    // The chips are siblings of the bubble, never inside it.
    expect(container.querySelector(".chat-bubble button, .chat-bubble .chip")).toBeNull();
    for (const row of container.querySelectorAll(".chip-row")) {
      expect(row.previousElementSibling?.classList.contains("chat-bubble")).toBe(true);
      const [act, other] = Array.from(row.querySelectorAll("button"));
      expect(act!.className).toContain("chip chip-act");
      expect(other!.className).toBe("chip");
      for (const b of [act!, other!]) expect(b.textContent).toMatch(/^[A-Z][a-z]*( [A-Z][a-z]*)*$/);
    }
  });
});

describe("a card being made", () => {
  it("keeps its place, with the chips at rest until the receipt is written", () => {
    const { container } = draw([proposal(moveTask, "approved")]);
    expect(container.querySelector(".chat-text")!.textContent).toContain("Call the plumber");
    for (const b of screen.getAllByRole("button")) expect(b).toHaveClass("chip-off");
    expect(screen.getByRole("button", { name: "Move Task" })).toHaveAttribute("aria-busy", "true");
  });
});

describe("a card that ran out of time", () => {
  it("still shows what it was, says nothing was changed, and can only be closed", () => {
    const { container, onApprove, onDismiss } = draw([proposal(moveTask, "expired")]);
    expect(container.querySelector(".chat-text")!.textContent).toContain("Due Fri, Oct 30 (was Thu, Oct 29)");
    expect(container.querySelector(".chat-prov")!.textContent).toBe("Timed out · Nothing was changed");
    expect(screen.queryByRole("button", { name: "Move Task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Not Now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe("no cards", () => {
  it("draws nothing at all", () => {
    const { container } = draw([]);
    expect(container.innerHTML).toBe("");
  });
});
