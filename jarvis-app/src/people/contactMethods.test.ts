import { describe, it, expect } from "vitest";
import {
  phonesOf, emailsOf, primaryPhone, primaryEmail, hasChoice,
  withPhones, withEmails, normEmail, normPhone, matchKeys,
} from "./contactMethods";

describe("contact methods", () => {
  // A person saved before the arrays existed must read exactly as they did.
  it("reads a person who only ever had one number", () => {
    const d = { phone: "555-010-3311", email: "lf@example.com" };
    expect(phonesOf(d)).toEqual([{ value: "555-010-3311" }]);
    expect(primaryPhone(d)).toBe("555-010-3311");
    expect(primaryEmail(d)).toBe("lf@example.com");
    expect(hasChoice(phonesOf(d))).toBe(false);
  });

  it("reads a person who has several, primary first", () => {
    const d = {
      phone: "555-010-3311",
      phones: [{ value: "555-010-3311", label: "mobile" }, { value: "555-010-9922", label: "home" }],
    };
    expect(phonesOf(d)).toEqual([
      { value: "555-010-3311", label: "mobile" },
      { value: "555-010-9922", label: "home" },
    ]);
    expect(primaryPhone(d)).toBe("555-010-3311");
    expect(hasChoice(phonesOf(d))).toBe(true);
  });

  // The legacy single and the array's first entry are the same number. It is
  // one row, not two.
  it("never shows one number twice because it sits in both shapes", () => {
    const d = { phone: "555-010-3311", phones: [{ value: "555-010-3311" }] };
    expect(phonesOf(d)).toHaveLength(1);
    // Case and spacing do not make a second entry either.
    expect(emailsOf({ email: "LF@Example.com", emails: [{ value: "lf@example.com " }] })).toHaveLength(1);
  });

  it("reads arrays alone, for a person saved without a primary", () => {
    expect(primaryPhone({ phones: [{ value: "555-010-9922", label: "work" }] })).toBe("555-010-9922");
  });

  it("drops blanks rather than offering a button that dials nothing", () => {
    expect(phonesOf({ phone: "", phones: [{ value: "   " }] })).toEqual([]);
    expect(primaryPhone({ phone: "" })).toBeUndefined();
  });

  // THE CONTRACT: a writer sets both halves at once, so they cannot drift.
  it("writes the list and the primary together", () => {
    const patch = withPhones([{ value: "555-010-3311", label: "mobile" }, { value: "555-010-9922" }]);
    expect(patch.phone).toBe("555-010-3311");
    expect(patch.phones).toEqual([{ value: "555-010-3311", label: "mobile" }, { value: "555-010-9922" }]);
    // Emptying clears both, which is how the last method is removed.
    expect(withEmails([])).toEqual({ email: undefined, emails: undefined });
  });

  it("keeps the label the source gave and invents none", () => {
    expect(withPhones([{ value: "555-010-3311" }]).phones).toEqual([{ value: "555-010-3311" }]);
  });
});

describe("matching keys", () => {
  // Normalize to FIND a candidate; the value the user typed is what stays on
  // the record and what gets dialled.
  it("reads one number written three ways as one number", () => {
    expect(normPhone("+1 (555) 010-3311")).toBe("5550103311");
    expect(normPhone("555-010-3311")).toBe("5550103311");
    expect(normPhone("15550103311")).toBe("5550103311");
  });

  it("refuses to make a key out of something too short to be a number", () => {
    // An extension or a partial would otherwise match everything.
    expect(normPhone("x4412")).toBe("");
    expect(normPhone("")).toBe("");
  });

  it("lowercases an address and nothing more", () => {
    // Stripping dots or +suffixes is a provider rule; guessing it merges two
    // real people.
    expect(normEmail("  LF@Example.com ")).toBe("lf@example.com");
    expect(normEmail("l.f+board@example.com")).toBe("l.f+board@example.com");
  });

  it("offers every comparable key a person has", () => {
    const keys = matchKeys({
      email: "lf@example.com",
      phones: [{ value: "+1 555 010 3311" }, { value: "x22" }],
    });
    expect(keys).toContain("e:lf@example.com");
    expect(keys).toContain("p:5550103311");
    // The unusable extension contributes nothing rather than a weak key.
    expect(keys).toHaveLength(2);
  });

  it("has no keys for a person with nothing reliable to match on", () => {
    expect(matchKeys({ })).toEqual([]);
  });
});
