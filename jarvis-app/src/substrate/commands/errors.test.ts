import { describe, it, expect } from "vitest";
import { COMMAND_ERROR_CODES, COMMAND_LINES, callCommand, failure, isCommandErrorCode, lineFor, newRequestId, type RpcClient } from "./errors";

const client = (data: unknown, error: unknown = null): RpcClient => ({ rpc: async () => ({ data, error }) });

describe("the command path's answers", () => {
  it("every code has one line, in fragments, with no sentence and no em dash", () => {
    for (const code of COMMAND_ERROR_CODES) {
      const line = COMMAND_LINES[code];
      expect(line.length).toBeGreaterThan(0);
      expect(line).not.toMatch(/\. [A-Z]/);
      expect(line).not.toMatch(/—/);
      expect(line.endsWith(".")).toBe(false);
    }
  });

  it("the spec's codes are all present", () => {
    for (const c of ["SOURCE_CHANGED", "DESTINATION_CHANGED", "MODULE_UNAVAILABLE", "MISSING_DETAILS", "REVIEW_CHANGED", "OUTCOME_UNKNOWN", "OFFLINE", "RATE_LIMITED", "PROVIDER_AUTH", "IDEMPOTENCY_CONFLICT", "APPROVAL_EXPIRED", "AUTH_REQUIRED"]) {
      expect(isCommandErrorCode(c)).toBe(true);
    }
    expect(isCommandErrorCode("approved")).toBe(false);
  });

  it("a function's refusal becomes a failure that keeps the owned facts", async () => {
    const r = await callCommand(client({ error: "SOURCE_CHANGED", revision: 3, payload: { issuer: "Con Edison" } }), "capture_approve", {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("SOURCE_CHANGED");
    expect(r.data).toEqual({ revision: 3, payload: { issuer: "Con Edison" } });
    expect(r.detail).toBeUndefined();
    expect(lineFor(r)).toBe("Email Changed · Review These Details");
  });

  it("a detail travels as the function's word, apart from the line", async () => {
    const r = await callCommand(client({ error: "INVALID_PAYLOAD", detail: "dismissed" }), "capture_approve", {});
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.detail).toBe("dismissed"); expect(r.data).toEqual({}); }
  });

  it("an unknown code and a transport error are UNAVAILABLE", async () => {
    const a = await callCommand(client({ error: "SOMETHING_NEW" }), "f", {});
    const b = await callCommand(client(null, { message: "boom" }), "f", {});
    const c = await callCommand({ rpc: async () => { throw new Error("down"); } }, "f", {});
    for (const r of [a, b, c]) { expect(r.ok).toBe(false); if (!r.ok) expect(r.code).toBe("UNAVAILABLE"); }
  });

  it("a result passes through whole", async () => {
    const r = await callCommand<{ action_id: string }>(client({ action_id: "a1", state: "confirmed" }), "f", {});
    expect(r).toEqual({ ok: true, value: { action_id: "a1", state: "confirmed" } });
  });

  it("failure() carries data and an optional detail", () => {
    expect(failure("NOT_FOUND")).toEqual({ ok: false, code: "NOT_FOUND", data: {} });
    expect(failure("MISSING_DETAILS", { missing: ["due_date"] }, "due")).toEqual({ ok: false, code: "MISSING_DETAILS", detail: "due", data: { missing: ["due_date"] } });
  });

  it("request ids are distinct per tap", () => {
    const seen = new Set(Array.from({ length: 50 }, () => newRequestId()));
    expect(seen.size).toBe(50);
  });
});
