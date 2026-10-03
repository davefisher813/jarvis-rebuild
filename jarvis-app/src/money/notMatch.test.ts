// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NOT_MATCH_KEY, loadNotMatches, pairKey, rememberNotMatch } from "./notMatch";

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("Not a Match is remembered", () => {
  it("keeps record|transaction pairs under a versioned key", () => {
    expect(NOT_MATCH_KEY).toMatch(/\.v\d+$/);
    rememberNotMatch("r1", "t1");
    rememberNotMatch("r2", "t9");
    expect([...loadNotMatches()].sort()).toEqual([pairKey("r1", "t1"), pairKey("r2", "t9")].sort());
    expect(pairKey("r1", "t1")).toBe("r1|t1");
  });

  it("starts empty, and survives damaged storage", () => {
    expect(loadNotMatches().size).toBe(0);
    localStorage.setItem(NOT_MATCH_KEY, "{not json");
    expect(loadNotMatches().size).toBe(0);
    localStorage.setItem(NOT_MATCH_KEY, JSON.stringify([1, "a|b", null]));
    expect([...loadNotMatches()]).toEqual(["a|b"]);
  });

  it("storage that throws does not throw: the answer holds for this visit", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadNotMatches().size).toBe(0);
    expect(rememberNotMatch("r1", "t1").has("r1|t1")).toBe(true);
  });
});
