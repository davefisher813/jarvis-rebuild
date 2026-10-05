// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "../../shared/tiptapTest";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("../../data/NotesProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data/NotesProvider")>()),
  useBrainDocs: () => ({ get: async () => "", save: async () => {} }),
  useOptionalStrands: () => ({ list: async () => [STRAND] }),
  useOptionalRules: () => null,
}));

describe("BrainDocPage: the writing facts follow the number rule (2026-10-05)", () => {
  it("a writing fact with evidence reads '3 Edits' in its facts line, never '3 edits'", async () => {
    const { container } = render(<BrainDocPage topic="writing" onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("Short and direct")).toBeInTheDocument());
    const facts = Array.from(container.querySelectorAll(".strand-row .fact")).map((f) => f.textContent);
    expect(facts).toContain("3 Edits");
    expect(facts.join(" ")).not.toMatch(/\d edits/);
  });
});
