import { describe, it, expect } from "vitest";
import { MIN_PASSWORD_LENGTH, PASSWORD_WORDS, passwordErrorOf, passwordProblem } from "./passwordRules";

describe("PASSWORD_WORDS", () => {
  // shortCopy law: no rendered string carries a sentence boundary; a second thought is joined with a middle dot.
  it("no message carries a full stop followed by a new sentence", () => {
    for (const [k, v] of Object.entries(PASSWORD_WORDS)) expect(v, k).not.toMatch(/\.\s+[A-Z]/);
  });
});

describe("passwordProblem", () => {
  const ok = { current: "old-pass-1", next: "new-pass-2", confirm: "new-pass-2" };

  it("a good change has no problem", () => {
    expect(passwordProblem(ok)).toBeNull();
  });

  it("asks for the current password first", () => {
    expect(passwordProblem({ ...ok, current: "" })).toEqual({ field: "current", message: PASSWORD_WORDS.needCurrent });
  });

  it("holds the new password to the same minimum as everywhere else", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(passwordProblem({ ...ok, next: "12345", confirm: "12345" })).toEqual({ field: "next", message: PASSWORD_WORDS.tooShort });
    expect(passwordProblem({ ...ok, next: "123456", confirm: "123456" })).toBeNull();
  });

  it("refuses a new password that is the current one", () => {
    expect(passwordProblem({ current: "same-pass", next: "same-pass", confirm: "same-pass" })).toEqual({ field: "next", message: PASSWORD_WORDS.sameAsCurrent });
  });

  it("refuses a confirmation that does not match", () => {
    expect(passwordProblem({ ...ok, confirm: "new-pass-3" })).toEqual({ field: "confirm", message: PASSWORD_WORDS.mismatch });
  });

  it("says too short before it says different, so one fix is asked for at a time", () => {
    expect(passwordProblem({ current: "abc", next: "abc", confirm: "abc" })?.message).toBe(PASSWORD_WORDS.tooShort);
  });
});

describe("passwordErrorOf: Supabase's refusals in plain words", () => {
  it("a wrong current password belongs to the current field and says what to do if there never was one", () => {
    const p = passwordErrorOf({ code: "invalid_credentials", message: "Invalid login credentials" });
    expect(p.field).toBe("current");
    expect(p.message).toMatch(/isn't your current password/);
    expect(p.message).toMatch(/Forgot Password/);
  });

  it("an older server that sends only words is understood too", () => {
    expect(passwordErrorOf(new Error("Invalid login credentials")).field).toBe("current");
    expect(passwordErrorOf(new Error("New password should be different from the old password.")).message).toBe(PASSWORD_WORDS.sameAsCurrent);
  });

  it("a weak password and a rate limit each get their own sentence", () => {
    expect(passwordErrorOf({ code: "weak_password" })).toEqual({ field: "next", message: PASSWORD_WORDS.tooWeak });
    expect(passwordErrorOf({ code: "over_request_rate_limit" })).toEqual({ field: null, message: PASSWORD_WORDS.tooManyTries });
    expect(passwordErrorOf({ status: 429 })).toEqual({ field: null, message: PASSWORD_WORDS.tooManyTries });
  });

  it("a dropped connection says so, and a gone session says to sign in again", () => {
    expect(passwordErrorOf(new TypeError("Failed to fetch")).message).toBe(PASSWORD_WORDS.offline);
    expect(passwordErrorOf({ name: "AuthRetryableFetchError", message: "x" }).message).toBe(PASSWORD_WORDS.offline);
    expect(passwordErrorOf({ code: "session_not_found" }).message).toBe(PASSWORD_WORDS.signedOut);
  });

  it("anything else is one honest line, never a code", () => {
    const p = passwordErrorOf({ code: "unexpected_failure", message: "boom 500" });
    expect(p.message).toBe(PASSWORD_WORDS.generic);
    expect(p.message).not.toMatch(/boom|500|unexpected_failure/);
  });
});
