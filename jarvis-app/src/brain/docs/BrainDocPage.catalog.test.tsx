// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "../../shared/tiptapTest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BrainDocPage from "./BrainDocPage";

// THE CATALOG, CHECKED ON WHAT THE PAGE DRAWS (Dave 2026-10-05). A writing fact's
// edit count was drawn "3 edits": the word behind a number is capitalized, and
// BrainTop's own row already did it through lineCase.
const STRAND = {
  id: "s1",
  data: {
    text: "Short and direct", category: "writing", source: "watched", strength: "influence", status: "active",
    createdAt: "2026-09-01", lastConfirmed: "2026-09-01", channel: "email",
    evidence: [{ day: "2026-09-01" }, { day: "2026-09-02" }, { day: "2026-09-03" }],
  },
};

const PROPOSAL = { id: "r1", data: { kind: "voice", scope: "draft.edit", from: "dropped_greeting", announced: false, evidence: [{}, {}] } };
const strandsSvc = { list: vi.fn(async () => [STRAND]), add: vi.fn(async () => "made"), setChannel: vi.fn(async () => {}) };
const rulesSvc = { list: vi.fn(async () => [PROPOSAL]), markAnnounced: vi.fn(async () => {}) };
const docsSvc = {
  get: async () => "", save: vi.fn(async () => {}),
  hardLines: async () => [{ kind: "never_file", match: "school.org" }, { kind: "protect", match: "Family" }],
};
vi.mock("../../data/NotesProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data/NotesProvider")>()),
  useBrainDocs: () => docsSvc,
  useOptionalStrands: () => strandsSvc,
  useOptionalRules: () => rulesSvc,
}));

describe("BrainDocPage: the writing facts follow the number rule (2026-10-05)", () => {
  it("a writing fact with evidence reads '3 Edits' in its facts line, never '3 edits'", async () => {
    const { container } = render(<BrainDocPage topic="writing" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Short and Direct")).toBeInTheDocument());
    const facts = Array.from(container.querySelectorAll(".strand-row .fact")).map((f) => f.textContent);
    expect(facts).toContain("3 Edits");
    expect(facts.join(" ")).not.toMatch(/\d edits/);
  });
});

// CLEAN ROWS (Dave 2026-10-05, locked): no capsule on a row; a row is a door, swipe left is its one quickest verb, and
// the sheet a tap opens holds every action.
describe("BrainDocPage: clean rows (2026-10-05)", () => {
  it("a proposed writing rule is a row with no capsule: That's Right is the swipe, the quiet word and the sheet's primary", async () => {
    const { container } = render(<BrainDocPage topic="writing" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Drops Formal Greetings in Email")).toBeInTheDocument());
    expect(container.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    expect(container.querySelector(".notice-alt")!.textContent).toBe("That's Right");
    expect(container.querySelector(".row-ctx")!.textContent).toBe("That's Right");
    fireEvent.click(screen.getByText("Drops Formal Greetings in Email"));
    const primary = container.querySelector(".sheet-scrim .btn-primary")!;
    expect(primary.textContent).toBe("That's Right");
    fireEvent.click(primary);
    await waitFor(() => expect(strandsSvc.add).toHaveBeenCalledWith("Drops formal greetings in email", "writing", expect.any(String), "influence", "pattern"));
  });

  it("a hard line is its words and one grey fact, with Remove behind the swipe and on its sheet, and no baked dot", async () => {
    const { container } = render(<BrainDocPage topic="values" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("school.org")).toBeInTheDocument());
    expect(container.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    const row = screen.getByText("school.org").closest(".row")!;
    expect([...row.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["Never File"]);
    expect(row.textContent).not.toContain("\u00b7");
    // The tray's one verb, then the sheet a tap opens.
    expect([...container.querySelectorAll(".notice-alt")].map((b) => b.textContent)).toEqual(["Remove", "Remove"]);
    fireEvent.click(row);
    expect(container.querySelector(".sheet-scrim .facts")!.textContent).toBe("Nothing from this is ever archived on its own");
    fireEvent.click(container.querySelector(".sheet-scrim .btn-danger-text")!);
    await waitFor(() => expect(screen.queryByText("school.org")).not.toBeInTheDocument());
    await waitFor(() => expect(docsSvc.save).toHaveBeenCalled());
  });
});
