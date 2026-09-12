// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import LearningLabPage from "./LearningLabPage";
import type { Strand } from "../brain/strands/types";
import "@testing-library/jest-dom";

// THE INSTRUMENT'S TESTS (from brain/strands/StrandsPage.test.tsx, moved with
// the instrument on 2026-09-12, C-39). What JARVIS Knows says one word per
// detector now; the numbers and the sentences live here, under Settings.

const strand = (over: Partial<Strand["data"]> = {}, id = "s1"): Strand => ({
  id,
  data: {
    text: "Gets things done mid morning", category: "energy", source: "watched",
    strength: "influence", status: "active", createdAt: "2026-08-01",
    lastConfirmed: "2026-08-20", derivation: "completion_window",
    evidence: [{ day: "2026-08-19", a: 9 }],
    ...over,
  },
});

const svc = { list: vi.fn(async () => [] as Strand[]) };
vi.mock("../data/NotesProvider", async (orig) => {
  const actual = await orig<typeof import("../data/NotesProvider")>();
  return { ...actual, useOptionalStrands: () => svc, useOptionalPeople: () => null };
});
vi.mock("../ai/useAIContext", () => ({
  useAIContext: () => async () => ({}),
  todayISO: (d?: Date) => (d ?? new Date("2026-08-24T12:00:00")).toISOString().slice(0, 10),
}));

describe("The Learning Lab says why the list is not growing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.list.mockResolvedValue([]);
    try { localStorage.clear(); } catch { /* private mode */ }
  });

  it("names where the evidence came from, in plain words", async () => {
    render(<LearningLabPage onBack={() => {}} />);
    await screen.findByText("The Evidence");
    // No Supabase client in a test build, so the read falls back to this
    // device's log, and the panel is required to say so rather than let a
    // server that was never reached look like a quiet month.
    expect(screen.getByText(/This device only/)).toBeInTheDocument();
    expect(screen.getByText("The Last 30 Days")).toBeInTheDocument();
  });

  it("gives every detector a row, so none of them fails invisibly", async () => {
    render(<LearningLabPage onBack={() => {}} />);
    await screen.findByText("What JARVIS Is Watching");
    for (const label of [
      "When Tasks Get Done", "The Area That Slips", "Whether Plans Finish",
      "When You Train", "When Email Gets Done", "The Person You Email Most",
      "Who Has Gone Quiet", "How Long Tasks Take",
    ]) {
      expect(screen.getByText(label), label + " lost its row").toBeInTheDocument();
    }
  });

  it("says what each detector is still waiting for, never just nothing", async () => {
    const { container } = render(<LearningLabPage onBack={() => {}} />);
    await screen.findByText("What JARVIS Is Watching");
    const whys = [...container.querySelectorAll(".rdy-why")].map((e) => e.textContent ?? "");
    expect(whys.length).toBeGreaterThanOrEqual(10); // 8 detectors plus the two evidence rows
    expect(whys.every((w) => w.trim().length > 0)).toBe(true);
    expect(whys.some((w) => w.includes("Needs 10 completions"))).toBe(true);
  });

  it("says the day's pass has recorded nothing, which is its own failure", async () => {
    const { container } = render(<LearningLabPage onBack={() => {}} />);
    await screen.findByText("The Day's Pass");
    expect(screen.getByText(/No day recorded yet/)).toBeInTheDocument();
    // And it never fakes a zero for a pass that has not run.
    const passRow = [...container.querySelectorAll(".rdy-row")]
      .find((e) => e.textContent?.includes("The Day's Pass"));
    expect(passRow?.querySelector(".rdy-n")).toBeNull();
  });

  it("a fact JARVIS already knows reads as known, not as a failure", async () => {
    svc.list.mockResolvedValue([strand()]); // derivation: completion_window
    const { container } = render(<LearningLabPage onBack={() => {}} />);
    await screen.findByText("When Tasks Get Done");
    const row = [...container.querySelectorAll(".rdy-row")]
      .find((e) => e.textContent?.includes("When Tasks Get Done"));
    expect(row?.textContent).toContain("already knows");
    expect(row?.querySelector(".rdy-n")?.className).toContain("rdy-good");
  });
});
