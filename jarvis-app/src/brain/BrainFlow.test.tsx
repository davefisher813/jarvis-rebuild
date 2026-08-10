// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useCategories } from "../data/NotesProvider";
import BrainFlow from "./BrainFlow";

// One Money (2026-08-10): Dave, "there should only be one money category with
// all of its features". Before this, tapping a "money" kind category here
// opened CategoryDetail, a page with no financial data on it at all — a
// second, broken "Money" living alongside the real Money tab. Now it never
// opens a page here; it hands off to onOpenMoney, whether the category was
// reached by tapping the row or by a search deep-link (openKey).

function Seeded({ openKey, onOpenMoney }: { openKey?: string; onOpenMoney?: () => void }) {
  const cats = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await cats.create("Money", "yellow"); // "Money" auto-suggests kind money
      await cats.create("Home", "blue"); // an ordinary category, unaffected
      setReady(true);
    })();
  }, [cats]);
  return ready ? <BrainFlow openKey={openKey} onOpenMoney={onOpenMoney} /> : null;
}

describe("BrainFlow: the Money category hands off to the real Money tab", () => {
  it("tapping the Money row calls onOpenMoney instead of opening a detail page", async () => {
    const onOpenMoney = vi.fn();
    render(<NotesProvider userId="b1"><Seeded onOpenMoney={onOpenMoney} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Money", { selector: ".conn-name" }));
    await waitFor(() => expect(onOpenMoney).toHaveBeenCalled());
    // Never lands on a category detail screen for it.
    expect(screen.queryByText("Up Next")).not.toBeInTheDocument();
  });

  it("an ordinary category still opens its own detail page, unaffected", async () => {
    const onOpenMoney = vi.fn();
    render(<NotesProvider userId="b2"><Seeded onOpenMoney={onOpenMoney} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Home"));
    await waitFor(() => expect(screen.getByText("Up Next")).toBeInTheDocument());
    expect(onOpenMoney).not.toHaveBeenCalled();
  });

  it("a search deep-link straight into the Money category also hands off, not a dead-end page", async () => {
    const onOpenMoney = vi.fn();
    function SeededDeepLink() {
      const c = useCategories();
      const [key, setKey] = useState<string | undefined>(undefined);
      useEffect(() => {
        (async () => {
          const moneyId = await c.create("Money", "yellow");
          setKey(moneyId!);
        })();
      }, [c]);
      return key ? <BrainFlow openKey={key} onOpenMoney={onOpenMoney} /> : null;
    }
    render(<NotesProvider userId="b3"><SeededDeepLink /></NotesProvider>);
    await waitFor(() => expect(onOpenMoney).toHaveBeenCalled());
    expect(screen.queryByText("Up Next")).not.toBeInTheDocument();
  });

  it("without onOpenMoney wired, falls back to the old detail page rather than doing nothing", async () => {
    render(<NotesProvider userId="b4"><Seeded /></NotesProvider>);
    fireEvent.click(await screen.findByText("Money", { selector: ".conn-name" }));
    // No onOpenMoney passed: the effect's guard (`!onOpenMoney`) means the
    // category still opens normally, so an un-wired caller never silently
    // eats the tap.
    await waitFor(() => expect(screen.getByText("Up Next")).toBeInTheDocument());
  });
});
