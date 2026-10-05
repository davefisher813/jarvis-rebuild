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

const svc = {
  list: vi.fn(async () => [] as Strand[]), confirm: vi.fn(async () => {}),
  add: vi.fn(async () => "made"), setChannel: vi.fn(async () => {}),
};
const rulesSvc = { list: vi.fn(async () => [] as unknown[]), markAnnounced: vi.fn(async () => {}) };
vi.mock("../data/NotesProvider", async (orig) => {
  const actual = await orig<typeof import("../data/NotesProvider")>();
  return { ...actual, useOptionalStrands: () => svc, useOptionalPeople: () => null, useOptionalRules: () => rulesSvc };
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
    rulesSvc.list.mockResolvedValue([]);
    rows = [];
  });

  it("renders nothing, and says so, when there is nothing to shape or to ask", async () => {
    const onBands = vi.fn();
    const { container } = render(<BrainTop onOpenFact={() => {}} onOpenWatching={() => {}} onBands={onBands} />);
    await waitFor(() => expect(onBands).toHaveBeenCalledWith(0));
    expect(container.querySelector(".sh2")).toBeNull();
  });

  // AMENDED 2026-09-26 (pass-off, Dave): the row's one grey is the fact's
  // category, the same row What JARVIS Knows draws; where a fact is used is
  // on its sheet, not the row.
  it("Shaping JARVIS Now: up to three live facts with state, confidence and the category", async () => {
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
    expect(cardRows[0]?.textContent).toContain("Bridge Wins Ties");
    const facts0 = [...cardRows[0]!.querySelectorAll(".fact")].map((e) => e.textContent);
    // §AK one grey (Dave 2026-09-26): the state word in caps, Rule, then the
    // category as the row's one grey. No list of screen names.
    expect(facts0).toEqual(["Known", "Rule", "Values"]);
    // The watched fact reads its confidence off the readiness row: 156 over 10 is High.
    const energy = cardRows.find((r) => r.textContent?.includes("Mid Morning"))!;
    const factsE = [...energy.querySelectorAll(".fact")].map((e) => e.textContent);
    expect(factsE).toEqual(["Learned", "High", "Energy"]);
    // Every row carries exactly one plain grey fact: the rest are caps or a key colour.
    for (const r of cardRows) {
      expect([...r.querySelectorAll(".fact:not(.st):not(.good):not(.warn):not(.red)")].length, r.textContent ?? "").toBe(1);
    }
    // Every row leads with the star; none is linked yet.
    expect(cardRows.every((r) => r.firstElementChild?.classList.contains("row-star"))).toBe(true);
    // One band: no detector is watching and nothing has faded.
    await waitFor(() => expect(onBands).toHaveBeenLastCalledWith(1));
    expect(screen.queryByText("Needs You")).toBeNull();
    fireEvent.click(cardRows[0]!);
    expect(onOpenFact).toHaveBeenCalledWith("s2");
  });

  // WATCHING IS NOT A NEED (Dave 2026-10-05, the review: "'Needs You' rows say nothing is needed"). A detector close to its
  // gate is JARVIS counting; it has its own quiet band after Needs You, with the detector's real glyph and the count as the
  // one grey (the head already says Watching, so the word is not repeated on the row), and the fading facts keep Needs You.
  it("Needs You holds the fading facts with Still True, capped at two; a watching detector has a band of its own", async () => {
    rows = [close, waiting];
    svc.list.mockResolvedValue([
      strand({ text: "Admin happens Friday afternoons", category: "routine", lastConfirmed: "2026-05-01" }, "s2"),
      strand({ text: "Old and quiet", category: "people", source: "told", lastConfirmed: "2026-04-01", derivation: undefined }, "s3"),
    ]);
    const onOpenWatching = vi.fn();
    const onBands = vi.fn();
    const { container } = render(<BrainTop onOpenFact={() => {}} onOpenWatching={onOpenWatching} onBands={onBands} />);
    await screen.findByText("Needs You");
    // Both facts are fading, so nothing is left to shape: Needs You and Watching, two bands.
    expect(screen.queryByText("Shaping JARVIS Now")).toBeNull();
    await waitFor(() => expect(onBands).toHaveBeenLastCalledWith(2));
    const needsHead = [...container.querySelectorAll(".sh2")].find((h) => h.textContent?.startsWith("Needs You"))!;
    const needsRows = [...needsHead.nextElementSibling!.querySelectorAll(".strand-row")];
    // Oldest unconfirmed first (fadedStrands), and the cap of two takes both fading facts.
    expect(needsRows.length).toBe(2);
    expect(needsRows[0]?.textContent).toContain("Old and Quiet");
    // The fading row is What JARVIS Knows' fading row: Fading, then the category as its one grey; the days live on the sheet.
    expect([...needsRows[0]!.querySelectorAll(".fact")].map((e) => e.textContent)).toEqual(["Fading", "People"]);
    expect(needsRows[1]?.textContent).toContain("Admin Happens Friday Afternoons");
    // Nothing in Needs You is a detector, and none wears the placeholder question mark.
    expect(needsHead.nextElementSibling!.textContent).not.toContain("The Area That Slips");
    expect(needsHead.nextElementSibling!.textContent).not.toContain("?");

    const watchHead = [...container.querySelectorAll(".sh2")].find((h) => h.textContent?.startsWith("Watching"))!;
    const watchRows = [...watchHead.nextElementSibling!.querySelectorAll(".strand-row")];
    expect(watchRows.length).toBe(1);
    expect(watchRows[0]?.textContent).toContain("The Area That Slips");
    // The count is the one fact; the state word is the head's, never repeated per row, and the glyph is not amber.
    expect([...watchRows[0]!.querySelectorAll(".fact")].map((e) => e.textContent)).toEqual(["4 of 5 Pushes in One Area"]);
    // One icon style on the screen (round 2 review): a bare glyph in its subject's tone, never a grey disc and never amber.
    expect(watchRows[0]!.querySelector(".warn-disc, .watch-disc, .lib-disc")).toBeNull();
    const watchGlyph = watchRows[0]!.querySelector(".lib-ico")!;
    expect(watchGlyph.querySelector("svg")).not.toBeNull();
    expect(watchGlyph.className).toContain("cat-fg-red");
    fireEvent.click(watchRows[0]!);
    expect(onOpenWatching).toHaveBeenCalledWith("slip_category");
    // Clean rows (Dave 2026-10-05): no capsule. Still True is the one quiet word on the fading row (the same verb as its
    // swipe-left tray button, which is why there are two of that label).
    expect(container.querySelector(".pill-act, .quiet-action")).toBeNull();
    fireEvent.click(container.querySelector(".row-ctx")!);
    await waitFor(() => expect(svc.confirm).toHaveBeenCalledWith(expect.objectContaining({ id: "s3" }), "2026-08-24"));
  });
});

// ALFRED 2026-10-04 (R2): "Brainstorms best at night", "Set up HighLevel account", "Trains between 11 AM and 2 PM in the
// morning". The facts are model-written sentences; the catalog says Title Case on every line the app writes, so each is
// drawn through lineCase (stored as written, the way a typed title is).
describe("BrainTop draws every fact in Title Case", () => {
  beforeEach(() => { vi.clearAllMocks(); rulesSvc.list.mockResolvedValue([]); rows = []; });

  it("the facts Alfred listed, as the rows draw them", async () => {
    svc.list.mockResolvedValue([
      strand({ text: "Brainstorms best at night", source: "told", derivation: undefined }, "a"),
      strand({ text: "Set up HighLevel account", source: "told", derivation: undefined }, "b"),
      strand({ text: "Finishes things across the whole day rather than in one stretch", source: "told", derivation: undefined }, "c"),
    ]);
    const { container } = render(<BrainTop onOpenFact={() => {}} onOpenWatching={() => {}} />);
    await screen.findByText("Shaping JARVIS Now");
    const names = [...container.querySelectorAll(".strand-row .conn-name")].map((e) => e.textContent).sort();
    expect(names).toEqual([
      "Brainstorms Best at Night",
      "Finishes Things Across the Whole Day Rather Than in One Stretch",
      "Set Up HighLevel Account",
    ]);
  });
});

// CLEAN ROWS (Dave 2026-10-05, locked). The Needs You rows carried capsules (That's Right, Only Sometimes, Not True,
// Still True). The row is a door now: it opens its sheet, swipe left is its one quickest answer, and the same answer is
// the one quiet word on the row because these rows are asking right now.
describe("Needs You: clean rows", () => {
  const proposal = { id: "r1", data: { kind: "voice", scope: "draft.edit", from: "dropped_greeting", announced: false, evidence: [{}, {}] } };
  beforeEach(() => { vi.clearAllMocks(); svc.list.mockResolvedValue([]); rulesSvc.list.mockResolvedValue([proposal]); rows = []; });

  it("a proposed writing rule has no capsule on its row, a Title Case sentence, and one quiet That's Right", async () => {
    const { container } = render(<BrainTop onOpenFact={() => {}} onOpenWatching={() => {}} />);
    await screen.findByText("Needs You");
    const row = container.querySelector(".strand-row")!;
    expect(row.querySelector(".conn-name")!.textContent).toBe("Drops Formal Greetings in Email");
    expect(container.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    const ctx = row.querySelector(".row-ctx")!;
    expect(ctx.textContent).toBe("That's Right");
    // The same verb is the swipe-left tray's first (only) button.
    expect(container.querySelector(".notice-alt")!.textContent).toBe("That's Right");
    // Facts are spans; the dot is CSS.
    expect([...row.querySelectorAll(".fact")].map((e) => e.textContent)).toEqual(["Needs Confirmation", "2 Edits"]);
    expect(row.textContent).not.toContain("\u00b7");
  });

  it("the row opens a sheet with the answer filled, and answering from it writes the strand", async () => {
    const { container } = render(<BrainTop onOpenFact={() => {}} onOpenWatching={() => {}} />);
    await screen.findByText("Needs You");
    fireEvent.click(container.querySelector(".strand-row")!);
    const sheet = container.querySelector(".sheet-scrim")!;
    expect(sheet.querySelector(".strand-head")!.textContent).toBe("Drops Formal Greetings in Email");
    const primary = sheet.querySelector(".btn-primary")!;
    expect(primary.textContent).toBe("That's Right");
    fireEvent.click(primary);
    await waitFor(() => expect(svc.add).toHaveBeenCalledWith("Drops formal greetings in email", "writing", "2026-08-24", "influence", "pattern"));
    expect(container.querySelector(".sheet-scrim")).toBeNull();
  });

  it("the quiet word on the row answers without opening anything", async () => {
    const { container } = render(<BrainTop onOpenFact={() => {}} onOpenWatching={() => {}} />);
    await screen.findByText("Needs You");
    fireEvent.click(container.querySelector(".row-ctx")!);
    await waitFor(() => expect(svc.add).toHaveBeenCalled());
    expect(container.querySelector(".sheet-scrim")).toBeNull();
  });
});

// ALFRED 2026-10-04: the Needs You band, and the Explore head over the nav list, were gone after a back from a page.
// The hub is unmounted while a page is open over it, and every remount began from empty and waited on the reads.
describe("the hub remembers its bands across a back", () => {
  beforeEach(() => { vi.clearAllMocks(); rulesSvc.list.mockResolvedValue([]); rows = [close]; });

  it("a remount paints Needs You and Explore on its first frame, before any read has come back", async () => {
    svc.list.mockResolvedValue([strand({ text: "Admin happens Friday afternoons", category: "routine", lastConfirmed: "2026-05-01" }, "s2")]);
    const memo = {};
    const first = render(<BrainPage onOpen={() => {}} memo={memo} />);
    await screen.findByText("Needs You");
    expect(screen.getByText("Explore")).toBeInTheDocument();
    first.unmount();
    // Nothing resolves now: a read that never returns (a slow phone, a dropped connection).
    svc.list.mockImplementation(() => new Promise<Strand[]>(() => {}));
    render(<BrainPage onOpen={() => {}} memo={memo} />);
    expect(screen.getByText("Needs You")).toBeInTheDocument();
    expect(screen.getByText("Explore")).toBeInTheDocument();
    expect(screen.getByText("The Area That Slips")).toBeInTheDocument();
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
