import { describe, it, expect } from "vitest";
import { settleAll, settleLine, type SettleWords } from "./settle";

const ARCHIVE: SettleWords = {
  one: "conversation", many: "conversations",
  did: "archived", doing: "archive", stuck: "still in your inbox",
};

describe("settleAll: what landed, not what was tried", () => {
  it("separates the writes that worked from the ones that did not", async () => {
    const r = await settleAll(["a", "b", "c"], (id) => id === "b" ? Promise.reject(new Error("500")) : Promise.resolve());
    expect(r.ok).toEqual(["a", "c"]);
    expect(r.failed).toEqual(["b"]);
  });

  it("never throws, whatever the batch does", async () => {
    // A batch is best-effort. The caller's job is to report honestly, not to
    // catch an exception, and a throw here would take the receipt with it.
    const r = await settleAll([1, 2], () => Promise.reject(new Error("down")));
    expect(r.ok).toEqual([]);
    expect(r.failed).toEqual([1, 2]);
  });

  it("counts a MISSING client as failed, not as skipped", async () => {
    // This is the bug that made the old loops lie. `apiFor(account)?.modify(...)`
    // returns undefined for an account that is no longer connected, and the
    // optional chain made that indistinguishable from a successful write.
    const r = await settleAll(["live", "disconnected"], (id) => id === "live" ? Promise.resolve() : undefined);
    expect(r.ok).toEqual(["live"]);
    expect(r.failed).toEqual(["disconnected"]);
  });

  it("returns the items themselves, so failed rows can go back", async () => {
    const rows = [{ id: "a" }, { id: "b" }];
    const r = await settleAll(rows, (row) => row.id === "a" ? Promise.resolve() : Promise.reject(new Error("x")));
    // Identity, not a copy: the caller puts these exact objects back in the list.
    expect(r.failed[0]).toBe(rows[1]);
  });

  it("handles an empty batch without inventing a result", async () => {
    const r = await settleAll([], () => Promise.resolve());
    expect(r).toEqual({ ok: [], failed: [] });
  });

  it("runs them concurrently rather than one after another", async () => {
    let live = 0;
    let peak = 0;
    await settleAll([1, 2, 3, 4], async () => {
      live++; peak = Math.max(peak, live);
      await Promise.resolve();
      live--;
    });
    expect(peak).toBeGreaterThan(1);
  });
});

describe("settleLine: a number he can check, never a hedge", () => {
  it("says the plain thing when everything worked", () => {
    expect(settleLine(6, 0, ARCHIVE)).toBe("6 conversations archived");
  });

  it("gets singular right, because '1 conversations' costs the number its credibility", () => {
    expect(settleLine(1, 0, ARCHIVE)).toBe("1 conversation archived");
  });

  it("names both halves when the batch was partial", () => {
    expect(settleLine(4, 2, ARCHIVE)).toBe("4 conversations archived · 2 still in your inbox");
  });

  it("does not claim a single one when none landed", () => {
    expect(settleLine(0, 1, ARCHIVE)).toBe("Couldn't archive it · Still in your inbox");
    expect(settleLine(0, 5, ARCHIVE)).toBe("Couldn't archive those · Still in your inbox");
  });

  it("never says 'some' or 'partially'", () => {
    for (const [a, b] of [[4, 2], [0, 3], [9, 0], [1, 1]]) {
      expect(settleLine(a!, b!, ARCHIVE)).not.toMatch(/some|partial/i);
    }
  });
});
