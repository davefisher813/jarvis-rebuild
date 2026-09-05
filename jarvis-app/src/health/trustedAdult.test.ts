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

// BRAIN-F-26 (2026-09-05, fork option A): "Hand It to Someone" dialled 988
// from anywhere on earth, and it connects in two countries. The athlete's own
// trusted adult comes first; a region we can state gets its line; a region we
// cannot gets no number, because one that does not connect is worse than none.
import { regionOf, crisisLineFor } from "./trustedAdult";

describe("the region behind a locale", () => {
  it("reads the region out of a locale tag, and says nothing when there is none", () => {
    expect(regionOf("en-US")).toBe("US");
    expect(regionOf("en_GB")).toBe("GB");
    expect(regionOf("es-419")).toBeNull();
    expect(regionOf("en")).toBeNull();
    expect(regionOf(undefined)).toBeNull();
  });
});

describe("the line for a region", () => {
  it("gives the US and Canada 988 and names the others it knows", () => {
    expect(crisisLineFor("US")?.number).toBe("988");
    expect(crisisLineFor("CA")?.number).toBe("988");
    expect(crisisLineFor("GB")?.label).toBe("Samaritans");
    expect(crisisLineFor("NZ")?.number).toBe("1737");
  });

  it("offers nothing rather than a number that would not connect", () => {
    expect(crisisLineFor("DE")).toBeNull();
    expect(crisisLineFor("JP")).toBeNull();
    expect(crisisLineFor(null)).toBeNull();
  });
});
