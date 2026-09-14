// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import InsightEvidence from "./InsightEvidence";
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

  it("Explain hands the evidence to the seam and shows the words under their own cite", async () => {
    const onExplain = vi.fn(async (e: Evidence) => "On the days you slept more, the number moved more. It says nothing about why.");
    render(<InsightEvidence evidence={ev} onExplain={onExplain} />);
    fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(onExplain).toHaveBeenCalledWith(ev);
    await waitFor(() => expect(screen.getByText(/On the days you slept more/)).toBeInTheDocument());
    expect(screen.getByText(/From your records \+ AI/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Explain" })).toBeNull();
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
