// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useCategories, useRules } from "../data/NotesProvider";
import LearnedRulesPage from "./LearnedRulesPage";

// B4 (2026-09-04): "What JARVIS Learned" used to render r.data.from/to
// verbatim, so a capture.category rule read "Elite Squad means c1" instead
// of the category's real name. Seed a category and a rule pointing at its
// raw id (exactly what QuickCapture.tsx's recordCorrection call stores),
// let the seed settle, then mount the page and confirm it shows the name.

function Seed({ onDone }: { onDone: () => void }) {
  const cats = useCategories();
  const rules = useRules();
  useEffect(() => {
    void (async () => {
      const catId = await cats.create("Elite Squad", "blue");
      await rules.restore({
        kind: "alias",
        scope: "capture.category",
        from: "Elite Squad",
        to: catId!,
        evidence: ['"Practice at 6" moved to Elite Squad'],
        createdAt: new Date().toISOString(),
      });
      onDone();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe("LearnedRulesPage resolves category ids to names", () => {
  it('shows "Elite Squad means Elite Squad", never the raw category id', async () => {
    let seeded = false;
    const { rerender } = render(
      <NotesProvider userId="u-rules">
        <Seed onDone={() => { seeded = true; }} />
      </NotesProvider>,
    );
    await waitFor(() => expect(seeded).toBe(true));

    rerender(
      <NotesProvider userId="u-rules">
        <Seed onDone={() => {}} />
        <LearnedRulesPage onBack={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText("Elite Squad means Elite Squad")).toBeInTheDocument());
  });
});
