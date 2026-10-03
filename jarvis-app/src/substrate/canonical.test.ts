import { describe, it, expect } from "vitest";
import { canonicalJson, hashPayload, sha256Hex } from "./canonical";

describe("canonical JSON: one form for one payload", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1, 2], c: "x" } })).toBe('{"a":{"c":"x","d":[3,1,2]},"b":1}');
  });

  it("normalises strings to NFC so two spellings of one word hash the same", () => {
    const composed = "Peña";
    const decomposed = "Peña";
    expect(canonicalJson({ n: decomposed })).toBe(canonicalJson({ n: composed }));
  });

  it("drops undefined values and treats -0 as 0", () => {
    expect(canonicalJson({ a: 1, b: undefined as unknown as null })).toBe('{"a":1}');
    expect(canonicalJson(-0)).toBe("0");
  });

  it("refuses a number that is not finite", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("hashes with the schema version in front, and any change moves it", async () => {
    const a = await hashPayload(1, { kind: "bill", amount: { minor_units: 14230, currency: "USD" } });
    const b = await hashPayload(1, { amount: { currency: "USD", minor_units: 14230 }, kind: "bill" });
    const c = await hashPayload(1, { kind: "bill", amount: { minor_units: 14231, currency: "USD" } });
    const d = await hashPayload(2, { kind: "bill", amount: { minor_units: 14230, currency: "USD" } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is SHA-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
