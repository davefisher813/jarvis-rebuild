import { describe, it, expect } from "vitest";
import { humanError } from "./humanError";

const FALLBACK = "Could not load mail";

describe("the machine's words never reach the screen", () => {
  it("turns the statuses a person can act on into instructions", () => {
    expect(humanError(new Error("gmail 401"), FALLBACK)).toMatch(/sign-in expired/i);
    expect(humanError(new Error("drafts 403"), FALLBACK)).toMatch(/permissions/i);
    expect(humanError(new Error("send 429"), FALLBACK)).toMatch(/rate-limiting/i);
    expect(humanError(new Error("thread 500"), FALLBACK)).toMatch(/trouble/i);
    expect(humanError(new Error("gmail 503"), FALLBACK)).toMatch(/trouble/i);
  });

  it("never shows a raw response body, whatever it contains", () => {
    // The exact string the audit found under "Couldn't Sort Your Mail".
    const raw = 'AI request failed (429). {"type":"error","error":{"type":"rate_limit_error","message":"Number of req';
    const out = humanError(new Error(raw), "Couldn't sort your mail");
    expect(out).not.toContain("{");
    expect(out).not.toContain("rate_limit_error");
    expect(out).toMatch(/rate-limiting/i);
  });

  it("falls back to the caller's sentence for anything it does not recognise", () => {
    expect(humanError(new Error("something weird happened"), FALLBACK)).toBe(FALLBACK);
    expect(humanError(new Error("gmail 418"), FALLBACK)).toBe(FALLBACK);
    expect(humanError({}, FALLBACK)).toBe(FALLBACK);
    expect(humanError(null, FALLBACK)).toBe(FALLBACK);
    expect(humanError(new Error(""), FALLBACK)).toBe(FALLBACK);
  });

  it("names being offline, because the browser's own wording does not", () => {
    expect(humanError(new TypeError("Failed to fetch"), FALLBACK)).toMatch(/offline/i);
    expect(humanError(new Error("NetworkError when attempting to fetch resource."), FALLBACK)).toMatch(/offline/i);
  });

  it("reads the status out of a message that also carries a body", () => {
    expect(humanError(new Error('send 401 {"error":"invalid_grant"}'), FALLBACK)).toMatch(/sign-in expired/i);
  });
});
