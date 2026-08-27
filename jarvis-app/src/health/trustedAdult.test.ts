import { describe, it, expect } from "vitest";
import { telHref, hasTrustedAdult, CRISIS_LINE_NUMBER } from "./trustedAdult";

describe("telHref", () => {
  it("strips formatting down to a dialable tel link", () => {
    expect(telHref("(555) 123-4567")).toBe("tel:5551234567");
  });

  it("preserves a leading plus for an international number", () => {
    expect(telHref("+1 555 123 4567")).toBe("tel:+15551234567");
  });
});

describe("hasTrustedAdult", () => {
  it("is false until both a name and a number are set", () => {
    expect(hasTrustedAdult("", "")).toBe(false);
    expect(hasTrustedAdult("Coach Lee", "")).toBe(false);
    expect(hasTrustedAdult("", "555-1234")).toBe(false);
    expect(hasTrustedAdult("Coach Lee", "555-1234")).toBe(true);
  });
});

describe("the crisis line", () => {
  it("is always 988, never gated behind anything this module could check", () => {
    expect(CRISIS_LINE_NUMBER).toBe("988");
  });
});
