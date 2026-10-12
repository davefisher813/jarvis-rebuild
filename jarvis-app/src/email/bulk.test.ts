// SELECT MODE'S COMMANDS (Email v1 spec 11): batches of at most 100 explicit
// ids, an outcome per message whatever happens to the request, and only proven
// failures offered again.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { REVERSE, attentionLine, doneLine, pickOf, reasonsOf, runBatch, tally, type Picked } from "./bulk";
import type { InboxRow } from "./emailClient";

const picks = (n: number, email = "dave@example.test"): Picked[] => Array.from({ length: n }, (_, i) => ({ rowId: `r${i}`, email, id: `p${i}` }));
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

beforeEach(() => { Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });

describe("runBatch", () => {
  it("sends at most 100 ids a request, each by its account and provider id, and answers per item", async () => {
    const bodies: Array<{ op: string; items: Array<{ email: string; id: string }> }> = [];
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init!.body)) as { op: string; items: Array<{ email: string; id: string }> };
      bodies.push(b);
      return ok({ op: b.op, results: b.items.map((x) => ({ ...x, status: "accepted", in_inbox: false })) });
    });
    const out = await runBatch("jwt", "archive", picks(230), f as unknown as typeof fetch);
    expect(bodies.map((b) => b.items.length)).toEqual([100, 100, 30]);
    expect(bodies[0]!.items[0]).toEqual({ email: "dave@example.test", id: "p0" });
    expect(out.length).toBe(230);
    expect(out.every((o) => o.result.status === "accepted")).toBe(true);
  });

  it("a request that fails as a whole answers for each item: no session is failed and not retried; a lost answer is unknown", async () => {
    const noSession = await runBatch(null, "read", picks(2));
    expect(noSession.map((o) => [o.result.status, o.result.code, o.result.retryable])).toEqual([["failed", "AUTH_REQUIRED", false], ["failed", "AUTH_REQUIRED", false]]);
    const lost = await runBatch("jwt", "read", picks(1), (async () => { throw new Error("reset"); }) as unknown as typeof fetch);
    expect(lost[0]!.result.status).toBe("unknown");
  });

  it("an item the server did not answer for is unknown, never assumed done", async () => {
    const out = await runBatch("jwt", "trash", picks(2), (async () => ok({ op: "trash", results: [{ email: "DAVE@example.test", id: "p0", status: "accepted" }] })) as unknown as typeof fetch);
    expect(out.map((o) => o.result.status)).toEqual(["accepted", "unknown"]);
  });
});

describe("tally and words", () => {
  it("done is accepted only; retry is only a proven, retryable failure", () => {
    const p = picks(4);
    const t = tally([
      { picked: p[0]!, result: { email: "d", id: "p0", status: "accepted" } },
      { picked: p[1]!, result: { email: "d", id: "p1", status: "failed", code: "UNAVAILABLE", retryable: true } },
      { picked: p[2]!, result: { email: "d", id: "p2", status: "failed", code: "NOT_FOUND", retryable: false } },
      { picked: p[3]!, result: { email: "d", id: "p3", status: "unknown" } },
    ]);
    expect(t.done.length).toBe(1);
    expect(t.attention.length).toBe(3);
    expect(t.retryable.map((x) => x.id)).toEqual(["p1"]);
    expect(reasonsOf(t.attention)).toEqual([["Gmail Didn't Change It", 1], ["Not in Saved Mail", 1], ["Not Confirmed by Gmail", 1]]);
  });
  it("says what happened in Title Case, and every op has its reverse", () => {
    expect(doneLine("archive", 28)).toBe("28 Archived");
    expect(doneLine("trash", 3)).toBe("3 Moved to Trash");
    expect(attentionLine(2)).toBe("2 Need Attention");
    expect(attentionLine(1)).toBe("1 Needs Attention");
    expect(REVERSE.trash).toBe("untrash");
    expect(REVERSE.archive).toBe("unarchive");
    expect(REVERSE.read).toBe("unread");
    expect(pickOf({ id: "u1", account: "a@x.test", provider_id: "m1" } as InboxRow)).toEqual({ rowId: "u1", email: "a@x.test", id: "m1" });
  });
});
