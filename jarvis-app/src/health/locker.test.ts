import { describe, it, expect } from "vitest";
import { currentDocs, expiringDocs, EXPIRY_WARN_DAYS, LOCKER_DOC_LABEL } from "./locker";
import type { LockerDocEntry } from "./types";

function doc(kind: LockerDocEntry["data"]["kind"], expiresAt: string | undefined, at: number): LockerDocEntry {
  return { id: kind + at, data: { category: "logistics", kind, label: LOCKER_DOC_LABEL[kind], expiresAt, at } };
}

describe("currentDocs", () => {
  it("keeps only the latest upload per kind", () => {
    const entries = [doc("physical", "2026-01-01", 1000), doc("physical", "2027-01-01", 2000)];
    const docs = currentDocs(entries);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.data.expiresAt).toBe("2027-01-01");
  });
});

describe("expiringDocs", () => {
  it("flags a document lapsing inside the warning window", () => {
    const entries = [doc("physical", "2026-09-10", 1000)];
    const out = expiringDocs(entries, "2026-08-27");
    expect(out).toHaveLength(1);
    expect(out[0]!.daysUntil).toBeLessThanOrEqual(EXPIRY_WARN_DAYS);
  });

  it("does not flag a document expiring far in the future", () => {
    const entries = [doc("physical", "2027-08-27", 1000)];
    expect(expiringDocs(entries, "2026-08-27")).toHaveLength(0);
  });

  it("flags an already-lapsed document with a negative days-until", () => {
    const entries = [doc("waiver", "2026-08-01", 1000)];
    const out = expiringDocs(entries, "2026-08-27");
    expect(out[0]!.daysUntil).toBeLessThan(0);
  });

  it("skips a document with no expiry at all", () => {
    const entries = [doc("insurance", undefined, 1000)];
    expect(expiringDocs(entries, "2026-08-27")).toHaveLength(0);
  });
});
