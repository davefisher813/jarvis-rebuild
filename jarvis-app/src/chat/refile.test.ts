import { describe, it, expect, vi } from "vitest";
import { refileWith } from "./refile";

// Audit 2026-09-11 item 7: a refile is a move, not a copy, and never a loss.
describe("refileWith", () => {
  it("delivers to the new place, then takes the old filing back, and hands back the new undo", async () => {
    const order: string[] = [];
    const undoPrev = vi.fn(async () => { order.push("undo-prev"); });
    const undoNext = vi.fn(async () => { order.push("undo-next"); });
    const next = await refileWith(async () => { order.push("deliver"); return undoNext; }, undoPrev);
    expect(order).toEqual(["deliver", "undo-prev"]);
    expect(next).toBe(undoNext);
  });

  it("a delivery that fails leaves the old filing in place", async () => {
    const undoPrev = vi.fn(async () => {});
    await expect(refileWith(async () => { throw new Error("offline"); }, undoPrev)).rejects.toThrow("offline");
    expect(undoPrev).not.toHaveBeenCalled();
  });

  it("an old filing that cannot be taken back does not fail the move", async () => {
    const next = await refileWith(async () => null, async () => { throw new Error("gone"); });
    expect(next).toBeNull();
  });
});
