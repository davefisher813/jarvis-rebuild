import { describe, it, expect } from "vitest";
import { carriesAuthority, validate, type Schema } from "./schema";

const S: Schema = {
  type: "object",
  fields: { id: { type: "uuid" }, name: { type: "string", min: 1, max: 5 }, kind: { type: "string", enum: ["a", "b"] }, n: { type: "integer", min: 0 }, tags: { type: "array", items: { type: "string" }, max: 2 } },
  optional: ["n", "tags"],
};
const ID = "11111111-2222-4333-8444-555555555555";

describe("the strict validator", () => {
  it("accepts the exact shape", () => {
    expect(validate({ id: ID, name: "ok", kind: "a" }, S)).toEqual({ ok: true });
    expect(validate({ id: ID, name: "ok", kind: "a", n: 3, tags: ["x"] }, S)).toEqual({ ok: true });
  });
  it("refuses an unknown property, naming it", () => {
    expect(validate({ id: ID, name: "ok", kind: "a", execute: true }, S)).toEqual({ ok: false, path: "$.execute", reason: "unknown property" });
  });
  it("refuses a missing required field and a wrong type", () => {
    expect(validate({ id: ID, kind: "a" }, S)).toMatchObject({ ok: false, path: "$.name" });
    expect(validate({ id: "nope", name: "ok", kind: "a" }, S)).toMatchObject({ ok: false, path: "$.id" });
    expect(validate({ id: ID, name: "ok", kind: "c" }, S)).toMatchObject({ ok: false, path: "$.kind" });
    expect(validate({ id: ID, name: "toolong", kind: "a" }, S)).toMatchObject({ ok: false, path: "$.name" });
    expect(validate({ id: ID, name: "ok", kind: "a", n: 1.5 }, S)).toMatchObject({ ok: false, path: "$.n" });
    expect(validate({ id: ID, name: "ok", kind: "a", tags: ["a", "b", "c"] }, S)).toMatchObject({ ok: false, path: "$.tags" });
    expect(validate({ id: ID, name: "ok", kind: "a", tags: [1] }, S)).toMatchObject({ ok: false, path: "$.tags[0]" });
  });
  it("caps free JSON by bytes", () => {
    expect(validate({ a: "x".repeat(10) }, { type: "json", maxBytes: 8 })).toMatchObject({ ok: false });
    expect(validate({ a: 1 }, { type: "json", maxBytes: 64 })).toEqual({ ok: true });
  });
  it("finds an authority key at any depth", () => {
    expect(carriesAuthority({ statement: "x", meta: { nested: [{ execute: true }] } })).toBe("execute");
    expect(carriesAuthority({ statement: "x", approved_by: "me" })).toBe("approved_by");
    expect(carriesAuthority({ statement: "x", rationale: "status quo" })).toBeNull();
  });
});
