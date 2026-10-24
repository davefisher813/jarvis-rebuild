import { describe, it, expect } from "vitest";
import { validateInput } from "./validate";
import { TOOL_REGISTRY } from "./registry";

// THE INPUT CHECK (chat box order, 2026-10-24). A model usually keeps to the schema it was given, and "usually" is not a gate: the
// dispatcher checks every call itself, with the reason when it says no.

const search = TOOL_REGISTRY.search_items.input_schema;
const schedule = TOOL_REGISTRY.get_schedule.input_schema;

describe("validateInput", () => {
  it("passes a call that keeps to the schema, optional fields included", () => {
    expect(validateInput(search, { query: "plumber" })).toBeNull();
    expect(validateInput(search, { query: "plumber", kinds: ["task", "note"], include_done: true, limit: 10 })).toBeNull();
  });

  it("names a missing required field", () => {
    expect(validateInput(search, {})).toBe("input.query is required");
    expect(validateInput(schedule, { from: "2026-10-26" })).toBe("input.to is required");
  });

  it("refuses a field the tool does not have (no free-form extras)", () => {
    expect(validateInput(search, { query: "x", sql: "drop table item" })).toBe("input.sql is not a field of this tool");
  });

  it("checks types: a number where text belongs, text where a number belongs, a list that is not one", () => {
    expect(validateInput(search, { query: 5 })).toBe("input.query must be text");
    expect(validateInput(search, { query: "x", limit: "3" })).toBe("input.limit must be a number");
    expect(validateInput(search, { query: "x", kinds: "task" })).toBe("input.kinds must be a list");
    expect(validateInput(search, { query: "x", include_done: "yes" })).toBe("input.include_done must be true or false");
  });

  it("checks sizes and ranges", () => {
    expect(validateInput(search, { query: "" })).toBe("input.query is too short");
    expect(validateInput(search, { query: "x".repeat(121) })).toBe("input.query is too long");
    expect(validateInput(search, { query: "x", limit: 0 })).toBe("input.limit is too small");
    expect(validateInput(search, { query: "x", limit: 11 })).toBe("input.limit is too large");
    expect(validateInput(search, { query: "x", limit: 2.5 })).toBe("input.limit must be a whole number");
    expect(validateInput(search, { query: "x", kinds: new Array(10).fill("task") })).toBe("input.kinds has too many items");
  });

  it("checks enums and patterns", () => {
    expect(validateInput(search, { query: "x", kinds: ["task", "bill"] })).toBe("input.kinds[1] is not one of the allowed values");
    expect(validateInput(schedule, { from: "next week", to: "2026-10-30" })).toBe("input.from is not the shape this tool takes");
  });

  it("refuses a body that is not an object at all", () => {
    for (const bad of [null, undefined, "search", 4, [], [{ query: "x" }]]) expect(validateInput(search, bad), String(bad)).toBe("input must be an object");
  });

  it("refuses NaN and infinity, which are numbers that are not", () => {
    expect(validateInput(search, { query: "x", limit: NaN })).toBe("input.limit must be a number");
    expect(validateInput(search, { query: "x", limit: Infinity })).toBe("input.limit must be a number");
  });

  it("stops at a type it does not know rather than letting it through", () => {
    expect(validateInput({ type: "object", properties: { a: { type: "mystery" } } }, { a: 1 })).toBe("input.a has a type this check does not know");
  });

  it("refuses a body nested past the depth it will read", () => {
    const deep: Record<string, unknown> = { type: "object", properties: {} };
    let cur = deep;
    let input: Record<string, unknown> = {};
    const root = input;
    for (let i = 0; i < 9; i++) {
      const next: Record<string, unknown> = { type: "object", properties: {} };
      (cur.properties as Record<string, unknown>).a = next;
      cur = next;
      const child: Record<string, unknown> = {};
      input.a = child;
      input = child;
    }
    expect(validateInput(deep, root)).toMatch(/nested too deeply/);
  });
});
