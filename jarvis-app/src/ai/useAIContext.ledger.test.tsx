// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { NotesProvider, useLedger } from "../data/NotesProvider";
import { useOptionalAIContext } from "./useAIContext";

// MONEY LEDGER (lane B): bills are their own records now. The model reads the
// same bills the Money tab shows, so Chat cannot quote a different number.
describe("the AI context carries ledger bills", () => {
  it("includes unpaid ledger bills (with a due date only when one was given) and leaves out paid ones", async () => {
    let seeded = false;
    function Seed() {
      const ledger = useLedger();
      useEffect(() => { void (async () => {
        await ledger.addBill({ vendor: "ConEdison", amount: 84.12, dueDate: "2026-10-05" });
        await ledger.addBill({ vendor: "Water", amount: 40 });
        const paid = await ledger.addBill({ vendor: "Old Bill", amount: 999, dueDate: "2026-09-01" });
        if (paid.ok) await ledger.markBillPaidByUser(paid.id, "2026-09-02");
        seeded = true;
      })(); }, [ledger]);
      return null;
    }
    const { result } = renderHook(() => useOptionalAIContext(), {
      wrapper: ({ children }) => <NotesProvider userId="u-ai-ledger"><Seed />{children}</NotesProvider>,
    });
    await waitFor(() => expect(seeded).toBe(true));
    await waitFor(async () => {
      const ctx = await result.current();
      expect(ctx?.billsLine).toContain("ConEdison $84.12 due Oct 5");
      // no due date given, none invented
      expect(ctx?.billsLine).toMatch(/Water \$40(;|$)/);
      expect(ctx?.billsLine).not.toContain("Old Bill");
    });
  });
});
