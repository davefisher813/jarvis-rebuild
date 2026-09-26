import { describe, it, expect } from "vitest";
import { humanError } from "./humanError";

const FALLBACK = "Could not load mail";

describe("the machine's words never reach the screen", () => {
  // The exact sentences, both halves: what happened, then what a person can
  // do about it. Every screen that shows a failure (the failed-send card,
  // Messages' error lines) reads these, so this is the one place the words
  // are pinned. One sentence each, joined with a semicolon, never a typed
  // dot (Colour Key F3, 2026-09-26): the card's meta line draws its own.
  it("turns the statuses a person can act on into instructions", () => {
    expect(humanError(new Error("gmail 401"), FALLBACK)).toBe("Your Google sign-in expired; reconnect in Settings");
    expect(humanError(new Error("drafts 403"), FALLBACK)).toBe("Google refused that; reconnect in Settings to update permissions");
    expect(humanError(new Error("send 429"), FALLBACK)).toBe("Google is rate-limiting us; try again in a minute");
    expect(humanError(new Error("thread 500"), FALLBACK)).toBe("Google's mail service is having trouble; try again shortly");
    expect(humanError(new Error("gmail 503"), FALLBACK)).toBe("Google's mail service is having trouble; try again shortly");
  });

  it("never shows a raw response body, whatever it contains", () => {
    // The exact string the audit found under "Couldn't Sort Your Mail".
    const raw = 'AI request failed (429). {"type":"error","error":{"type":"rate_limit_error","message":"Number of req';
    const out = humanError(new Error(raw), "Couldn't sort your mail");
    expect(out).not.toContain("{");
    expect(out).not.toContain("rate_limit_error");
    expect(out).toBe("Google is rate-limiting us; try again in a minute");
  });

  it("falls back to the caller's sentence for anything it does not recognise", () => {
    expect(humanError(new Error("something weird happened"), FALLBACK)).toBe(FALLBACK);
    expect(humanError(new Error("gmail 418"), FALLBACK)).toBe(FALLBACK);
    expect(humanError({}, FALLBACK)).toBe(FALLBACK);
    expect(humanError(null, FALLBACK)).toBe(FALLBACK);
    expect(humanError(new Error(""), FALLBACK)).toBe(FALLBACK);
  });

  it("names being offline, because the browser's own wording does not", () => {
    expect(humanError(new TypeError("Failed to fetch"), FALLBACK)).toBe("You're offline; nothing was lost");
    expect(humanError(new Error("NetworkError when attempting to fetch resource."), FALLBACK)).toBe("You're offline; nothing was lost");
  });

  it("reads the status out of a message that also carries a body", () => {
    expect(humanError(new Error('send 401 {"error":"invalid_grant"}'), FALLBACK)).toBe("Your Google sign-in expired; reconnect in Settings");
  });
});
