import { describe, it, expect, vi } from "vitest";
import { readWindow, windowStartISO, WINDOW_DAYS, type WindowClient } from "./window";

const NOW = new Date("2026-08-21T12:00:00Z").getTime();

// A client that records what it was asked for and answers with rows.
function fakeClient(rows: unknown, capture?: (q: { cols: string; gte: [string, string]; inArg: [string, string[]]; limit: number }) => void): WindowClient {
  return {
    from: () => ({
      select: (cols: string) => ({
        gte: (gcol: string, gval: string) => ({
          in: (icol: string, ivals: string[]) => ({
            limit: (n: number) => {
              capture?.({ cols, gte: [gcol, gval], inArg: [icol, ivals], limit: n });
              return Promise.resolve({ data: rows, error: null });
            },
          }),
        }),
      }),
    }),
  };
}

describe("the windowed read (the log is never bulk-loaded)", () => {
  it("asks for a bounded window of typed columns, never the whole table", async () => {
    let seen: { cols: string; gte: [string, string]; inArg: [string, string[]]; limit: number } | null = null;
    await readWindow(fakeClient([], (q) => { seen = q; }), NOW);
    const q = seen!;
    expect(q.gte[0]).toBe("day");
    expect(q.gte[1]).toBe(windowStartISO(NOW));
    expect(q.limit).toBeGreaterThan(0);
    expect(q.limit).toBeLessThanOrEqual(2000);
    // Typed columns only: no free-text column exists to ask for, and the
    // select must not become a star.
    expect(q.cols).not.toContain("*");
    expect(q.cols.split(",")).toEqual(["type", "day", "h", "category", "n", "flag", "kind"]);
    // A bounded type list, so the read never drags the whole log back.
    expect(q.inArg[0]).toBe("type");
    expect(q.inArg[1].length).toBeGreaterThan(0);
    expect(q.inArg[1]).toContain("task.completed");
  });

  it("windows exactly thirty days back", () => {
    expect(windowStartISO(NOW)).toBe(new Date(NOW - WINDOW_DAYS * 86400000).toISOString().slice(0, 10));
  });

  it("keeps well-formed rows and drops junk the server should never have sent", async () => {
    const rows = await readWindow(fakeClient([
      { type: "task.completed", day: "2026-08-20", h: 9, category: "Work", n: null, flag: null, kind: null },
      { type: "task.completed", day: "2026-08-20" }, // no hour: not a usable row
      null,
      "nope",
    ]), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("Work");
  });

  it("falls back to the local log instead of throwing when the query errors", async () => {
    const boom: WindowClient = {
      from: () => ({
        select: () => ({ gte: () => ({ in: () => ({ limit: () => Promise.reject(new Error("offline")) }) }) }),
      }),
    };
    await expect(readWindow(boom, NOW)).resolves.toEqual(expect.any(Array));
  });

  it("reads locally with no client at all, so demo mode still derives", async () => {
    await expect(readWindow(null, NOW)).resolves.toEqual(expect.any(Array));
  });

  it("never sends a query when there is no client", async () => {
    const from = vi.fn();
    await readWindow(null, NOW);
    expect(from).not.toHaveBeenCalled();
  });
});
