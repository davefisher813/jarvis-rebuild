// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import InsightEvidence, { InsightCard, EXPLAIN_NOTE } from "./InsightEvidence";
import { evidenceText, explainEvidence, EXPLAIN_SYSTEM } from "./explainInsight";
import type { Evidence } from "../gym/insights";
import type { AIService } from "../ai/AIService";

// Part 3 wave 3 (2026-09-13): every finding opens on its own receipt.
const ev: Evidence = {
  label: "Exploratory Pattern", from: "2026-08-01", to: "2026-09-12", records: 12,
  method: "Change from one session to the next, paired with Sleep the same day, split at your own median",
  supports: "A difference on higher Sleep days against lower Sleep days",
  doesNot: "Cause, or what to change",
  minimum: { name: "Paired sessions", value: 10, reason: "fewer than ten same-day pairs is noise dressed as a pattern" },
};

describe("InsightEvidence", () => {
  it("opens the seven rows on Evidence and closes them again", () => {
    render(<InsightEvidence evidence={ev} />);
    expect(screen.queryByText("Exploratory Pattern")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    expect(screen.getByText("Exploratory Pattern")).toBeInTheDocument();
    expect(screen.getByText("Aug 1 to Sep 12")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(ev.method)).toBeInTheDocument();
    expect(screen.getByText(ev.supports)).toBeInTheDocument();
    expect(screen.getByText(ev.doesNot)).toBeInTheDocument();
    expect(screen.getByText(/Paired sessions 10 · fewer than ten/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide Evidence" }));
    expect(screen.queryByText("Exploratory Pattern")).toBeNull();
  });

  // §AK (2026-09-26): "Caps is for a label, never a sentence". The line that
  // says where the words came from is a sentence, so it is the note UNDER
  // the card (a bare .input-hint), never a caps cite inside it.
  it("Explain hands the evidence to the seam and shows the words, with their note under the card", async () => {
    const onExplain = vi.fn(async (e: Evidence) => "On the days you slept more, the number moved more. It says nothing about why.");
    const { container } = render(<InsightCard evidence={ev} onExplain={onExplain}><div className="ins-line">A finding</div></InsightCard>);
    expect(screen.queryByText(EXPLAIN_NOTE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(onExplain).toHaveBeenCalledWith(ev);
    await waitFor(() => expect(screen.getByText(/On the days you slept more/)).toBeInTheDocument());
    const note = screen.getByText(EXPLAIN_NOTE);
    expect(note).toHaveClass("input-hint");
    expect(note.closest(".card")).toBeNull();
    expect(container.querySelector(".ins-cite")).toBeNull();
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();
    // Hiding the evidence hides the words, and the note that goes with them.
    fireEvent.click(screen.getByRole("button", { name: "Hide Evidence" }));
    await waitFor(() => expect(screen.queryByText(EXPLAIN_NOTE)).toBeNull());
  });

  it("a card's own note sits under the card, and an open explanation joins it rather than adding a second", async () => {
    const onExplain = vi.fn(async () => "It moved more on better nights.");
    render(<InsightCard evidence={ev} onExplain={onExplain} note="Never a prescription, just an offer."><div className="ins-line">A finding</div></InsightCard>);
    const foot = screen.getByText(/Never a prescription, just an offer\./);
    expect(foot).toHaveClass("input-hint");
    expect(foot.closest(".card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    await waitFor(() => expect(screen.getByText(/It moved more on better nights/)).toBeInTheDocument());
    expect(document.querySelectorAll(".input-hint")).toHaveLength(1);
    expect(document.querySelector(".input-hint")!.textContent).toBe("Never a prescription, just an offer. " + EXPLAIN_NOTE);
  });

  // The note sits at the card's own edge, 16px from the screen, as settings'
  // Foot does beside its Card. The caller's one .pad-x insets the card and
  // the note together; a .pad-x of the card's own would stack on it and push
  // the note to 32px, inside the card's edge.
  it("the note and the card share the caller's one .pad-x, so the note lines up with the card's edge", () => {
    const { container } = render(
      <div className="pad-x">
        <InsightCard note="Never a prescription, just an offer."><div className="ins-line">A finding</div></InsightCard>
      </div>,
    );
    const padXAncestors = (el: Element) => { let n = 0; for (let p = el.parentElement; p; p = p.parentElement) if (p.classList.contains("pad-x")) n++; return n; };
    const card = container.querySelector(".ins-card")!;
    const foot = screen.getByText(/Never a prescription, just an offer\./);
    expect(padXAncestors(card)).toBe(1);
    expect(padXAncestors(foot)).toBe(1);
    expect(foot.parentElement).toBe(card.parentElement);
  });
});

describe("explainEvidence", () => {
  it("hands the model only the rows, forbids new numbers and advice, and strips dashes from the answer", async () => {
    const calls: { user: string; system: string }[] = [];
    const ai = { available: true, complete: vi.fn(async (m: { content: string }[], sys: string) => { calls.push({ user: m[0]!.content, system: sys }); return "It moved more \u2014 on better nights."; }) } as unknown as AIService;
    const out = await explainEvidence(ai, ev);
    expect(calls[0]!.user).toBe(evidenceText(ev));
    expect(calls[0]!.user).toContain("Records: 12");
    expect(calls[0]!.system).toBe(EXPLAIN_SYSTEM);
    expect(EXPLAIN_SYSTEM).toMatch(/Do not add a number/);
    expect(out).not.toContain("\u2014");
  });
});
