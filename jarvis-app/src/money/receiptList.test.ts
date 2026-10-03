import { describe, it, expect } from "vitest";
import { legacyFiles, newestFirst } from "./receiptList";
import type { Receipt } from "./ledger/types";
import type { UserFile } from "../files/types";

const rec = (id: string, date: string, born: string, attachmentFileId?: string): Receipt => ({
  id, data: {
    vendor: id, amountCents: 100, currency: "USD", transactionDate: date, source: "manual", fingerprint: id,
    ...(attachmentFileId ? { attachmentFileId } : {}), history: [{ at: born, by: "user", action: "created" }],
  },
});
const file = (id: string, path: string): UserFile => ({ id, data: { name: id, path, mime: "image/png", bytes: 1, scope: "money", addedAt: "2026-09-01" } });

describe("what the Receipts section lists", () => {
  it("newest first by the receipt's day, the one just written first on a tie", () => {
    const got = newestFirst([rec("a", "2026-09-01", "2026-10-01T00:00:00Z"), rec("b", "2026-09-08", "2026-10-01T00:00:00Z"), rec("c", "2026-09-08", "2026-10-02T00:00:00Z")]);
    expect(got.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("does not reorder the caller's list", () => {
    const input = [rec("a", "2026-09-01", "x"), rec("b", "2026-09-08", "x")];
    newestFirst(input);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps legacy files: a file no record names, with bytes stored", () => {
    const got = legacyFiles([file("f1", "u/f1.png"), file("f2", "u/f2.png"), file("f3", "")], [rec("a", "2026-09-01", "x", "f2")]);
    expect(got.map((f) => f.id)).toEqual(["f1"]);
  });
});
