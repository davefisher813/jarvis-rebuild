// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import MemorySheet from "./MemorySheet";
import type { BrainMemoryRow } from "../../ai/brainMemory";

// THE CATALOG, CHECKED ON WHAT THE SHEET DRAWS (Dave 2026-10-05). The kicker was one string with
// a dot baked into it drawn in one .fact ("Decision · Active"), and the day filed and a voice
// sample's length were two more plain-grey lines under the text.
vi.mock("../../data/NotesProvider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../data/NotesProvider")>()),
  useBrainMemory: () => ({ update: async () => true, unfile: async () => true, supersede: async () => true, markReversed: async () => true, pending: () => false }),
}));

const row = (over: Partial<BrainMemoryRow["data"]> = {}): BrainMemoryRow => ({
  id: "r1", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  data: { category: "decision", state: "learned", text: "Use the school gym", why: "It is closer", date: "2026-09-04", status: "active", source: "brain", ...over } as BrainMemoryRow["data"],
});

describe("MemorySheet: the catalog (2026-10-05)", () => {
  it("the kicker is separate facts and none carries a typed dot", () => {
    render(<MemorySheet row={row()} onClose={() => {}} onChanged={() => {}} />);
    const facts = Array.from(document.querySelectorAll(".eyebrow .fact")).map((f) => f.textContent);
    expect(facts).toEqual(["Decision", "Active", "Filed From The Brain Tab"]);
    for (const f of facts) expect(f).not.toContain("·");
  });

  it("the day filed is a small-caps date fact and a voice sample's length a white number, on one facts line", () => {
    render(<MemorySheet row={row({ category: "voice", wordCount: 141 })} onClose={() => {}} onChanged={() => {}} />);
    const line = document.querySelector(".sheet-form > .facts")!;
    expect(line.querySelector(".fact.date")!.textContent).toMatch(/^Sep 4/);
    expect(line.querySelector(".fact > b")!.textContent).toBe("141 Words");
    expect(document.querySelectorAll(".sheet-form > .conn-meta")).toHaveLength(1);
  });
});
