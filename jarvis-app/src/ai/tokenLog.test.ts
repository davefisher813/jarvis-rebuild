import { describe, it, expect } from "vitest";
import { tokenRow } from "./tokenLog";

describe("tokenRow", () => {
  it("shapes a full row from a normal usage block", () => {
    expect(tokenRow("u1", "triage", "claude-sonnet-5", { input_tokens: 812, output_tokens: 203 })).toEqual({
      user_id: "u1", kind: "triage", model: "claude-sonnet-5", input_tokens: 812, output_tokens: 203,
    });
  });

  it("returns null when the reply carried no counts at all", () => {
    expect(tokenRow("u1", "triage", "m", undefined)).toBeNull();
    expect(tokenRow("u1", "triage", "m", {})).toBeNull();
    expect(tokenRow("u1", "triage", "m", { input_tokens: "812", output_tokens: null })).toBeNull();
  });

  it("keeps a partial count, zero-filling the missing side", () => {
    expect(tokenRow("u1", "", "m", { input_tokens: 40 })).toEqual({
      user_id: "u1", kind: "", model: "m", input_tokens: 40, output_tokens: 0,
    });
  });

  it("rejects negative and non-finite counts, floors fractions", () => {
    expect(tokenRow("u1", "k", "m", { input_tokens: -5, output_tokens: Infinity })).toBeNull();
    expect(tokenRow("u1", "k", "m", { input_tokens: 10.9 })!.input_tokens).toBe(10);
  });
});
