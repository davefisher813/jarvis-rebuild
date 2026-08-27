import { describe, it, expect } from "vitest";
import { handoffItems } from "./handoff";
import type { RefillState } from "./refillRunway";
import type { LockerDocEntry } from "./types";

const NO_REFILL: RefillState = { hasFill: false, dosesInFill: 0, taken: 0, remaining: 0 };

describe("handoffItems", () => {
  it("carries no body data: only refill/locker/logistics kinds ever appear", () => {
    const refill: RefillState = { hasFill: true, dosesInFill: 30, taken: 27, remaining: 3 };
    const docs: LockerDocEntry[] = [{ id: "d1", data: { category: "logistics", kind: "physical", label: "Physical", expiresAt: "2026-09-01", at: 1000 } }];
    const items = handoffItems(refill, docs, "2026-08-27", [{ line: "Pay The Ref Fee" }]);
    expect(items.map((i) => i.kind).sort()).toEqual(["locker", "logistics", "refill"]);
  });

  it("says nothing about a refill that is not close", () => {
    const refill: RefillState = { hasFill: true, dosesInFill: 30, taken: 2, remaining: 28 };
    expect(handoffItems(refill, [], "2026-08-27")).toEqual([]);
  });

  it("never names a medication, only the errand", () => {
    const refill: RefillState = { hasFill: true, dosesInFill: 10, taken: 8, remaining: 2 };
    const items = handoffItems(refill, [], "2026-08-27");
    expect(items[0]!.line).not.toMatch(/mg|stimulant|adderall|ritalin/i);
    expect(items[0]!.line).toMatch(/pharmacy/i);
  });

  it("passes external logistics candidates through untouched", () => {
    const items = handoffItems(NO_REFILL, [], "2026-08-27", [{ line: "Drive To The 4pm Practice" }]);
    expect(items).toEqual([{ kind: "logistics", line: "Drive To The 4pm Practice" }]);
  });

  it("flags a lapsed document differently from one expiring soon", () => {
    const lapsed: LockerDocEntry[] = [{ id: "d1", data: { category: "logistics", kind: "waiver", label: "Waiver", expiresAt: "2026-08-01", at: 1000 } }];
    const items = handoffItems(NO_REFILL, lapsed, "2026-08-27");
    expect(items[0]!.line).toMatch(/Lapsed/);
  });
});
