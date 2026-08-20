import { describe, it, expect, vi } from "vitest";
import { lastContactFor, agoLabel, isQuiet, QUIET_DAYS, checkinPrompt } from "./lastContact";
import type { GmailThreadMeta } from "../connections/google/map";

// Last contact (2026-08-10): the derivation behind "Last talked 3 weeks ago"
// on people-kind category pages.

const NOW = Date.parse("2026-08-10T12:00:00Z");

function memStorage(): Pick<Storage, "getItem" | "setItem"> & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v; },
  };
}

const threadAt = (ms: number): GmailThreadMeta => ({
  id: "t1",
  messages: [{
    id: "m1", threadId: "t1", internalDate: String(ms), snippet: "hey",
    payload: { headers: [{ name: "From", value: "Sam <sam@x.com>" }, { name: "Subject", value: "Hi" }] },
  } as unknown as NonNullable<GmailThreadMeta["messages"]>[number]],
});

describe("lastContactFor", () => {
  it("queries both directions and returns the latest message time", async () => {
    const search = vi.fn().mockResolvedValue([threadAt(1755000000000)]);
    const ms = await lastContactFor({ searchThreads: search }, "Sam@X.com", NOW, memStorage());
    expect(search).toHaveBeenCalledWith("to:sam@x.com OR from:sam@x.com", 1);
    expect(ms).toBe(1755000000000);
  });

  it("caches per address: the second call inside a day never hits the API", async () => {
    const search = vi.fn().mockResolvedValue([threadAt(1755000000000)]);
    const storage = memStorage();
    await lastContactFor({ searchThreads: search }, "sam@x.com", NOW, storage);
    const again = await lastContactFor({ searchThreads: search }, "sam@x.com", NOW + 1000, storage);
    expect(search).toHaveBeenCalledTimes(1);
    expect(again).toBe(1755000000000);
  });

  it("no thread at all is an honest null, cached like any answer", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const storage = memStorage();
    expect(await lastContactFor({ searchThreads: search }, "new@x.com", NOW, storage)).toBeNull();
    expect(await lastContactFor({ searchThreads: search }, "new@x.com", NOW + 1000, storage)).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("a network failure returns the stale cache instead of poisoning it", async () => {
    const storage = memStorage();
    await lastContactFor({ searchThreads: vi.fn().mockResolvedValue([threadAt(1700000000000)]) }, "sam@x.com", NOW, storage);
    // Two days later the cache is expired and the network is down.
    const later = NOW + 2 * 86400000;
    const ms = await lastContactFor({ searchThreads: vi.fn().mockRejectedValue(new Error("offline")) }, "sam@x.com", later, storage);
    expect(ms).toBe(1700000000000);
  });

  it("empty email is null without any API call", async () => {
    const search = vi.fn();
    expect(await lastContactFor({ searchThreads: search }, "  ", NOW, memStorage())).toBeNull();
    expect(search).not.toHaveBeenCalled();
  });
});

describe("agoLabel and isQuiet", () => {
  it("renders human distances", () => {
    expect(agoLabel(NOW - 3600e3, NOW)).toBe("today");
    expect(agoLabel(NOW - 1 * 86400000, NOW)).toBe("yesterday");
    expect(agoLabel(NOW - 6 * 86400000, NOW)).toBe("6 Days ago");
    expect(agoLabel(NOW - 21 * 86400000, NOW)).toBe("3 Weeks ago");
    expect(agoLabel(NOW - 90 * 86400000, NOW)).toBe("3 Months ago");
  });

  it("quiet means silent past the shared threshold, and never for unknowns", () => {
    expect(isQuiet(NOW - (QUIET_DAYS + 1) * 86400000, NOW)).toBe(true);
    expect(isQuiet(NOW - (QUIET_DAYS - 1) * 86400000, NOW)).toBe(false);
    expect(isQuiet(null, NOW)).toBe(false);
  });
});

describe("checkinPrompt", () => {
  it("carries the no-guilt guardrail, the gap, and the user's voice", () => {
    const p = checkinPrompt("Mom", "2 Months ago", "short sentences, warm");
    expect(p.system).toContain("Zero guilt about the gap");
    expect(p.system).toContain("short sentences, warm");
    expect(p.user).toContain("Mom");
    expect(p.user).toContain("2 Months ago");
  });

  it("builds without a voice, for tests and failed context gathering", () => {
    const p = checkinPrompt("Sam", "3 Weeks ago");
    expect(p.system).not.toContain("Write it as this person");
  });
});
