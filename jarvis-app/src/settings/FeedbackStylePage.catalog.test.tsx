// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { FeedbackProvider } from "../encourage/FeedbackProvider";
import { setLiveFeedback } from "../encourage/prefs";
import { lineCase } from "../shared/casing";
import { capsulesInCards } from "../laws/catalogCheck";
import FeedbackStylePage from "./FeedbackStylePage";

vi.mock("../shared/toast", () => ({ showToast: () => {}, subscribeToast: () => () => {} }));

// THE VISUAL CATALOG, HELD ON FEEDBACK STYLE (Dave 2026-10-05, "I am sick of
// this"). The page's grey sub lines and field notes, read from the DOM the
// real page draws.

const MIDDOT = "·";
const page = () => render(
  <NotesProvider userId="fb-catalog"><FeedbackProvider><FeedbackStylePage onBack={() => {}} /></FeedbackProvider></NotesProvider>,
);

beforeEach(() => { localStorage.clear(); setLiveFeedback(null); });

describe("FeedbackStylePage follows the catalog", () => {
  it("every grey line under a row name is Title Case", () => {
    const { container } = page();
    const metas = [...container.querySelectorAll(".conn-meta")].map((m) => m.textContent ?? "");
    expect(metas.length, "the page has sub lines to judge").toBeGreaterThan(0);
    for (const t of metas) expect(lineCase(t), `"${t}" is not Title Case`).toBe(t);
  });

  it("a sub line never repeats its row, or a note beside it", () => {
    const { container } = page();
    const rows = [...container.querySelectorAll(".row")];
    const hear = rows.find((r) => r.querySelector(".conn-name")?.textContent === "Hear It")!;
    expect(hear.querySelector(".conn-meta"), "Hear It already says what it does").toBeNull();
    const haptics = rows.find((r) => r.querySelector(".conn-name")?.textContent === "Haptics")!;
    expect(haptics.querySelector(".conn-meta"), "the note below already says both start off").toBeNull();
    for (const r of rows) {
      const name = r.querySelector(".conn-name")?.textContent ?? "";
      const meta = r.querySelector(".conn-meta")?.textContent ?? "";
      if (meta) expect(meta.toLowerCase(), `${name}: the sub line is not its own name`).not.toContain(name.toLowerCase());
    }
  });

  it("Hear It is a clean row that plays on tap, with a speaker glyph and no capsule (Dave 2026-10-05: no pills in a row)", () => {
    const { container } = page();
    const hear = [...container.querySelectorAll(".row")].find((r) => r.querySelector(".conn-name")?.textContent === "Hear It")!;
    expect(hear.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    expect(hear.querySelector(".row-value svg")).not.toBeNull();
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("a note under a card is one sentence or dot-joined fragments, never two sentences", () => {
    const { container } = page();
    const notes = [...container.querySelectorAll(".input-hint")].map((n) => n.textContent ?? "");
    expect(notes.length).toBeGreaterThan(0);
    for (const t of notes) {
      expect(t, "no '. ' followed by a capital in a rendered string").not.toMatch(/\. [A-Z]/);
    }
    expect(notes.filter((t) => t.includes(MIDDOT)).length, "the multi-part notes join with a dot").toBeGreaterThanOrEqual(3);
  });

  it("draws no facts line of its own, so there is no typed dot to leak into one", () => {
    const { container } = page();
    for (const f of container.querySelectorAll(".fact")) expect(f.textContent).not.toContain(MIDDOT);
    for (const el of container.querySelectorAll<HTMLElement>("[style]")) {
      expect(el.getAttribute("style")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });
});
