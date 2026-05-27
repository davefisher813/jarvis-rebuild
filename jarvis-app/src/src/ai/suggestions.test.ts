import { describe, it, expect } from "vitest";
import { parseSuggestions } from "./suggestions";

describe("parseSuggestions", () => {
  it("parses a JSON array of strings", () => {
    expect(parseSuggestions('["Email Sam","Call Maya"]')).toEqual(["Email Sam", "Call Maya"]);
  });
  it("handles code fences and caps at two", () => {
    expect(parseSuggestions('```json\n["a","b","c"]\n```')).toEqual(["a", "b"]);
  });
  it("returns empty for non-array or junk", () => {
    expect(parseSuggestions("no idea")).toEqual([]);
    expect(parseSuggestions('{"x":1}')).toEqual([]);
    expect(parseSuggestions("[]")).toEqual([]);
  });
});
