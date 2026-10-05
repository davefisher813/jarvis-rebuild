// @vitest-environment jsdom
//
// DELETE DECISION, AND THE TWO TAPS IN FRONT OF IT (button audit phase 2,
// 2026-09-19). DecisionService.remove is covered at the service level in
// decisions.test.ts, but the UI gate in front of it was not: nothing
// asserted that the first tap only ARMS, or that the record comes back.
//
// The gate matters because of what this record is. A decision carries the
// reasoning behind a choice, which is the part nobody can reconstruct later,
// and the list is meant to be the place that reasoning survives. So the
// first tap must not delete, and the Undo must put back the SAME record --
// deleteRecord calls svc.restore(id, kept) rather than create() for exactly
// that reason (BRAIN-F-14: create() re-dates the record to now and re-arms a
// revisit that was already answered).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useDecisions } from "../data/NotesProvider";
import type { DecisionService } from "./DecisionService";
import type { DecisionRecord } from "./types";
import DecisionsFlow from "./DecisionsFlow";

const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a), hideToast: () => {} }));

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const DECISION = {
  decision: "Student template ships before the other two are even started",
  why: "Northlake gives 60 warm leads on day one",
};

// Seeded from inside the provider and BEFORE the flow reads, the same shape
// DecisionsList.test.tsx uses: the flow loads once on mount, so a record
// created after that never reaches the list.
function Seed({ onReady }: { onReady: (s: DecisionService, id: string) => void }) {
  const svc = useDecisions();
  useEffect(() => { void svc.create(DECISION).then((id) => onReady(svc, id!)); }, [svc, onReady]);
  return null;
}

beforeEach(() => { showToast.mockReset(); localStorage.clear(); });

describe("DecisionsFlow: Delete Decision", () => {
  it("asks first, deletes on the confirm, and Undo restores the same record", async () => {
    let svc: DecisionService | null = null;
    let id = "";
    const { container } = render(
      <NotesProvider userId="u-dec-delete">
        <Seed onReady={(s, made) => { svc = s; id = made; }} />
        <DecisionsFlow onBack={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => { expect(svc).toBeTruthy(); expect(id).toBeTruthy(); });

    // Open the record. The sentence is clamped across elements, so the row
    // itself is the handle, not its text.
    const row = await waitFor(() => {
      const n = container.querySelector(".dec-name");
      expect(n?.textContent).toContain("Student Template Ships");
      return n!;
    }, { timeout: 4000 });
    await act(async () => { fireEvent.click(row); });

    // THE DELETE IS IN THE RECORD'S MORE MENU, behind its own confirm (Dave 2026-10-05: no capsule or action row in a card).
    // Choosing Delete in the menu only ASKS; the record is still there afterwards, which is the whole reason it takes two
    // taps instead of one.
    expect(screen.queryByRole("button", { name: "Delete Decision" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "More" })); });
    const del = await screen.findByRole("button", { name: "Delete Decision" });
    await act(async () => { fireEvent.click(del); });
    expect((await svc!.list()).some((r: DecisionRecord) => r.id === id)).toBe(true);

    // The confirm says what the next tap does.
    expect(await screen.findByText("Delete This Decision?")).toBeInTheDocument();
    const confirm = await screen.findByRole("button", { name: "Delete Decision" });
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(async () => expect((await svc!.list()).some((r: DecisionRecord) => r.id === id)).toBe(false));

    // And the way back restores the record itself, under its own id, with
    // the reasoning intact.
    const call = showToast.mock.calls
      .map((c) => c[0] as { message: string; actionLabel?: string; onAction?: () => void })
      // Casing sweep 3 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "About 1 Min").
      .find((c) => c.message === "Decision Deleted");
    expect(call).toBeTruthy();
    expect(call!.actionLabel).toBe("Undo");
    await act(async () => { call!.onAction!(); });
    await waitFor(async () => {
      const back = (await svc!.list()).find((r: DecisionRecord) => r.id === id);
      expect(back).toBeTruthy();
      expect(back!.data.why).toBe(DECISION.why);
    });
  });
});
