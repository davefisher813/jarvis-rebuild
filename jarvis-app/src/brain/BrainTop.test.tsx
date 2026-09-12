// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BrainTop from "./BrainTop";
import BrainPage from "./BrainPage";
import type { Strand } from "./strands/types";
import type { Readiness } from "./readiness";
import "@testing-library/jest-dom";

// C-38 (Astra, 2026-09-12): the Brain's live top. Rendered through the real
// component with the strand store and the readiness read stubbed, because a
// tested ranking proves nothing about whether a screen shows it.

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

const svc = { list: vi.fn(async () => [] as Strand[]), confirm: vi.fn(async () => {}) };
vi.mock("../data/NotesProvider", async (orig) => {
  const actual = await orig<typeof import("../data/NotesProvider")>();
  return { ...actual, useOptionalStrands: () => svc, useOptionalPeople: () => null };
});
vi.mock("../ai/useAIContext", () => ({
  useAIContext: () => async () => ({}),
  todayISO: (d?: Date) => (d ?? new Date("2026-08-24T12:00:00")).toISOString().slice(0, 10),
}));
// The detectors, with one of them close to its gate, so Needs You has a
// WATCHING row to show without seeding a month of events.
let rows: Readiness[] = [];
vi.mock("./readiness", async (orig) => {
  const actual = await orig<typeof import("./readiness")>();
  return { ...actual, readiness: () => rows };
});

const close: Readiness = { key: "slip_category", label: "The Area That Slips", have: 4, need: 5, unit: "pushes in one area", state: "close" };
const waiting: Readiness = { key: "plan_rate", label: "Whether Plans Finish", have: 1, need: 10, unit: "plan picks resolved", state: "waiting" };
const known: Readiness = { key: "completion_window", label: "When Tasks Get Done", have: 156, need: 10, unit: "completions", state: "known" };

describe("BrainTop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.list.mockResolvedValue([]);
    rows = [];
  });

  it("renders nothing, and says so, when there is nothing to shape or to ask", async () => {
    const onBands = vi.fn();
    const { container } = render(<BrainTop onOpenFact={() => {}} onOpenWatching={() => {}} onBands={onBands} />);
    await waitFor(() => expect(onBands).toHaveBeenCalledWith(0));
    expect(container.querySelector(".sh2")).toBeNull();
  });

  it("Shaping JARVIS Now: up to three live facts with state, confidence and where they are used", async () => {
    rows = [known, waiting];
    svc.list.mockResolvedValue([
      strand(),
      strand({ text: "Bridge wins ties over optional Jarvis work", category: "values", source: "told", strength: "rule", derivation: undefined }, "s2"),
      strand({ text: "Drops formal greetings in email", category: "writing", source: "watched", derivation: "email_window" }, "s3"),
      strand({ text: "A fourth fact", category: "people", source: "told", derivation: undefined }, "s4"),
    ]);
    const onOpenFact = vi.fn();
    const onBands = vi.fn();
    const { container } = render(<BrainTop onOpenFact={onOpenFact} onOpenWatching={() => {}} onBands={onBands} />);
    await screen.findByText("Shaping JARVIS Now");
    const cardRows = [...container.querySelectorAll(".strand-row")];
    expect(cardRows.length).toBe(3);
    // told outranks watched in rankForRecall, so the rule leads.
    expect(cardRows[0]?.textContent).toContain("Bridge wins ties");
    const facts0 = [...cardRows[0]!.querySelectorAll(".fact")].map((e) => e.textContent);
    expect(facts0).toEqual(["Known", "Rule", "Your Move", "Schedule", "Decisions"]);
    // The watched fact reads its confidence off the readiness row: 156 over 10 is High.
    const energy = cardRows.find((r) => r.textContent?.includes("mid morning"))!;
    const factsE = [...energy.querySelectorAll(".fact")].map((e) => e.textContent);
    expect(factsE).toEqual(["Learned", "High", "Schedule", "Plan My Day", "Your Move"]);
    // Every row leads with the star; none is linked yet.
    expect(cardRows.every((r) => r.firstElementChild?.classList.contains("row-star"))).toBe(true);
    // One band: no detector is watching and nothing has faded.
    await waitFor(() => expect(onBands).toHaveBeenLastCalledWith(1));
    expect(screen.queryByText("Needs You")).toBeNull();
    fireEvent.click(cardRows[0]!);
    expect(onOpenFact).toHaveBeenCalledWith("s2");
  });

  it("Needs You: a watching detector first, then a fading fact with Still True, capped at two", async () => {
    rows = [close, waiting];
    svc.list.mockResolvedValue([
      strand({ text: "Admin happens Friday afternoons", category: "routine", lastConfirmed: "2026-05-01" }, "s2"),
      strand({ text: "Old and quiet", category: "people", source: "told", lastConfirmed: "2026-04-01", derivation: undefined }, "s3"),
    ]);
    const onOpenWatching = vi.fn();
    const onBands = vi.fn();
    const { container } = render(<BrainTop onOpenFact={() => {}} onOpenWatching={onOpenWatching} onBands={onBands} />);
    await screen.findByText("Needs You");
    // Both facts are fading, so nothing is left to shape: one band.
    expect(screen.queryByText("Shaping JARVIS Now")).toBeNull();
    await waitFor(() => expect(onBands).toHaveBeenLastCalledWith(1));
    const cardRows = [...container.querySelectorAll(".strand-row")];
    expect(cardRows.length).toBe(2);
    expect(cardRows[0]?.textContent).toContain("The Area That Slips");
    expect([...cardRows[0]!.querySelectorAll(".fact")].map((e) => e.textContent)).toEqual(["Watching", "4 of 5 pushes in one area"]);
    // Oldest unconfirmed first (fadedStrands), and the cap of two leaves the
    // other fading fact for What JARVIS Knows.
    expect(cardRows[1]?.textContent).toContain("Old and quiet");
    expect([...cardRows[1]!.querySelectorAll(".fact")].map((e) => e.textContent)).toEqual(["Fading", "145 days unconfirmed"]);
    expect(screen.queryByText("Admin happens Friday afternoons")).toBeNull();
    fireEvent.click(cardRows[0]!);
    expect(onOpenWatching).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Still True"));
    await waitFor(() => expect(svc.confirm).toHaveBeenCalledWith(expect.objectContaining({ id: "s3" }), "2026-08-24"));
  });
});

describe("BrainPage with the top bands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [];
  });

  it("puts Explore over the nav list only when a band renders", async () => {
    svc.list.mockResolvedValue([]);
    const { rerender } = render(<BrainPage onOpen={() => {}} />);
    await waitFor(() => expect(svc.list).toHaveBeenCalled());
    expect(screen.queryByText("Explore")).toBeNull();
    svc.list.mockResolvedValue([strand({ source: "told", derivation: undefined })]);
    rerender(<BrainPage onOpen={() => {}} key="again" />);
    await screen.findByText("Shaping JARVIS Now");
    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("What JARVIS Knows")).toBeInTheDocument();
  });
});
