import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEND_HOLD_MS, DISPATCH_WINDOW_MS, holdRemainingMs, holdSeconds } from "./sendHold";

describe("the send hold", () => {
  it("is 30 seconds, and the database says the same (migration 0059)", () => {
    expect(SEND_HOLD_MS).toBe(30000);
    expect(DISPATCH_WINDOW_MS).toBe(30000);
    const sql = readFileSync(resolve(__dirname, "../../../jarvis-core/supabase/migrations/0059_send_hold.sql"), "utf8");
    expect(sql).toContain("hold_until = now() + interval '30 seconds'");
    expect(sql).toContain("dispatch_deadline = now() + interval '60 seconds'");
    expect(SEND_HOLD_MS + DISPATCH_WINDOW_MS).toBe(60000);
  });

  it("no other send window exists in the Email code (no 5 or 10 second Undo)", () => {
    for (const f of ["../email/EmailFlow.tsx", "../email/SendReviewScreen.tsx", "../email/SendOutcomeScreen.tsx"]) {
      const src = readFileSync(resolve(__dirname, f), "utf8");
      expect(src).not.toMatch(/\b(5000|10000)\b.*\b(undo|send)/i);
    }
  });

  it("counts down from the SERVER's clock, not the phone's", () => {
    const h = { hold_until: "2026-10-08T12:00:30.000Z", dispatch_deadline: "2026-10-08T12:01:00.000Z", server_now: "2026-10-08T12:00:00.000Z" };
    expect(holdRemainingMs(h, 1_000_000, 1_000_000)).toBe(30000);
    expect(holdRemainingMs(h, 1_000_000, 1_012_000)).toBe(18000);
    expect(holdRemainingMs(h, 1_000_000, 1_040_000)).toBe(0);
    // A phone clock that jumped backwards cannot add time.
    expect(holdRemainingMs(h, 1_000_000, 900_000)).toBe(30000);
    expect(holdRemainingMs({ ...h, server_now: "nonsense" }, 0, 0)).toBe(0);
  });

  it("rounds up so it never says 0s while the hold is running", () => {
    expect(holdSeconds(30000)).toBe(30);
    expect(holdSeconds(1)).toBe(1);
    expect(holdSeconds(0)).toBe(0);
    expect(holdSeconds(-5)).toBe(0);
  });
});
