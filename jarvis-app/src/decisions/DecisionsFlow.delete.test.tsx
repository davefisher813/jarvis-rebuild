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
  it("arms on the first tap, deletes on the second, and Undo restores the same record", async () => {
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
      expect(n?.textContent).toContain("Student template ships");
      return n!;
    }, { timeout: 4000 });
    await act(async () => { fireEvent.click(row); });

    // FIRST TAP ARMS ONLY. The record is still there afterwards; this is the
    // whole reason the control takes two taps instead of one.
    const del = await screen.findByRole("button", { name: "Delete Decision" });
    await act(async () => { fireEvent.click(del); });
    expect((await svc!.list()).some((r: DecisionRecord) => r.id === id)).toBe(true);

    // The armed face says what the next tap does.
    const confirm = await screen.findByRole("button", { name: "Tap to Confirm" });
    await act(async () => { fireEvent.click(confirm); });
    await waitFor(async () => expect((await svc!.list()).some((r: DecisionRecord) => r.id === id)).toBe(false));

    // And the way back restores the record itself, under its own id, with
    // the reasoning intact.
    const call = showToast.mock.calls
      .map((c) => c[0] as { message: string; actionLabel?: string; onAction?: () => void })
      .find((c) => c.message === "Decision deleted");
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
