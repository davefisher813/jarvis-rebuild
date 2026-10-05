import { describe, it, expect } from "vitest";
import { groupErrors, ERROR_TOP, ERROR_WINDOW, type RawClientError } from "./adminErrors";

// 2026-10-05: the Errors section's arithmetic. One bug on many phones must be
// one line with a count, and the line must describe the newest report of it.

const row = (fingerprint: string, created_at: string, over: Partial<RawClientError> = {}): RawClientError => ({
  fingerprint, created_at, name: "TypeError", message: "m", build: "b1", platform: "ios", ...over,
});

describe("groupErrors", () => {
  it("folds rows with one fingerprint into one group with a count", () => {
    const g = groupErrors([
      row("a", "2026-10-05T10:00:00Z"), row("a", "2026-10-05T09:00:00Z"), row("a", "2026-10-04T09:00:00Z"),
      row("b", "2026-10-05T08:00:00Z"),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ fingerprint: "a", count: 3 });
    expect(g[1]).toMatchObject({ fingerprint: "b", count: 1 });
  });

  it("reports first and last seen whatever order the rows arrive in", () => {
    const g = groupErrors([
      row("a", "2026-10-04T09:00:00Z"), row("a", "2026-10-05T10:00:00Z"), row("a", "2026-10-03T01:00:00Z"),
    ]);
    expect(g[0]).toMatchObject({ firstSeen: "2026-10-03T01:00:00Z", lastSeen: "2026-10-05T10:00:00Z" });
  });

  it("orders by instant, not by the text of the timestamp", () => {
    // Same moment written two ways: the offset one is LATER as an instant
    // (10:00+00:00 vs 10:30+02:00 = 08:30Z) though it sorts after as text.
    const g = groupErrors([row("a", "2026-10-05T10:30:00.000000+02:00"), row("a", "2026-10-05T10:00:00+00:00")]);
    expect(g[0]!.firstSeen).toBe("2026-10-05T10:30:00.000000+02:00");
    expect(g[0]!.lastSeen).toBe("2026-10-05T10:00:00+00:00");
  });

  it("describes the group by its newest report: the build and platform that last broke", () => {
    const g = groupErrors([
      row("a", "2026-10-01T00:00:00Z", { build: "old", platform: "web", message: "old words" }),
      row("a", "2026-10-05T00:00:00Z", { build: "new", platform: "ios", message: "new words" }),
    ]);
    expect(g[0]).toMatchObject({ build: "new", platform: "ios", message: "new words" });
  });

  it("sorts most often first, then most recent first", () => {
    const g = groupErrors([
      row("rare-new", "2026-10-05T10:00:00Z"),
      row("often", "2026-10-01T00:00:00Z"), row("often", "2026-10-01T01:00:00Z"),
      row("rare-old", "2026-10-02T00:00:00Z"),
    ]);
    expect(g.map((x) => x.fingerprint)).toEqual(["often", "rare-new", "rare-old"]);
  });

  it("fills a missing name, message, build or platform instead of drawing a blank", () => {
    const g = groupErrors([{ fingerprint: "a", created_at: "2026-10-05T00:00:00Z", name: null, message: null, build: null, platform: null }]);
    expect(g[0]).toMatchObject({ name: "Error", message: "", build: "", platform: "other" });
  });

  it("an empty window is no groups", () => {
    expect(groupErrors([])).toEqual([]);
  });

  it("states the window and the list length it is read with", () => {
    expect(ERROR_WINDOW).toBe(200);
    expect(ERROR_TOP).toBe(20);
  });
});
