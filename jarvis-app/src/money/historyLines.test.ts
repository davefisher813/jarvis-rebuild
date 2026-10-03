import { describe, it, expect } from "vitest";
import { historyLines } from "./historyLines";

describe("a record's history in plain words", () => {
  it("says the day, what happened, and the before and after of a correction", () => {
    const lines = historyLines([
      { at: "2026-10-02T12:00:00.000Z", by: "user", action: "created" },
      { at: "2026-10-03T09:00:00.000Z", by: "user", action: "corrected", changes: {
        amountCents: { from: 4712, to: 4800 }, transactionDate: { from: "2026-09-08", to: "2026-09-09" }, category: { to: "Groceries" },
      } },
    ]);
    expect(lines.map((l) => [l.day, l.what])).toEqual([["2026-10-02", "Created"], ["2026-10-03", "Corrected"]]);
    expect(lines[0]!.changes).toEqual([]);
    expect(lines[1]!.changes).toEqual(["Amount $47.12 to $48.00", "Date Sep 8 to Sep 9", "Category none to Groceries"]);
  });

  it("never shows an id: a link is said as linked or unlinked", () => {
    const lines = historyLines([
      { at: "2026-10-03T09:00:00.000Z", by: "user", action: "matched to a transaction", changes: { linkedTransactionId: { to: "abc-123" } } },
      { at: "2026-10-04T09:00:00.000Z", by: "user", action: "unmatched", changes: { linkedTransactionId: { from: "abc-123" } } },
    ]);
    expect(lines.map((l) => l.changes)).toEqual([["Payment linked"], ["Payment unlinked"]]);
    expect(JSON.stringify(lines)).not.toContain("abc-123");
  });

  it("a record with no history, or a damaged one, is an empty list", () => {
    expect(historyLines(undefined)).toEqual([]);
    expect(historyLines("nope" as never)).toEqual([]);
  });
});
