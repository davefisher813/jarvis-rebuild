import { describe, it, expect } from "vitest";
import { MAX_TOOL_INPUT_BYTES, MAX_TOOL_RESULT_BYTES, MAX_TOOL_USE_PER_REPLY, shapeReply, toolBlockOk, utf8Bytes } from "./wire";

// WHAT A TOOL CALL LOOKS LIKE ON THE WIRE (chat box order, 2026-10-24). This is the door a hostile body would use, so both directions
// are held here: what the proxy lets in, and what it lets out.

const ALLOWED = new Set(["search_items", "get_schedule"]);
const use = (over: Record<string, unknown> = {}) => ({ type: "tool_use", id: "toolu_01AbCdEf", name: "search_items", input: { query: "plumber" }, ...over });
const result = (over: Record<string, unknown> = {}) => ({ type: "tool_result", tool_use_id: "toolu_01AbCdEf", content: '{"ok":true}', ...over });

describe("toolBlockOk: a tool_use may only be the assistant's, a tool_result only the person's turn", () => {
  it("accepts a well-formed call and its result in their own roles", () => {
    expect(toolBlockOk(use(), "assistant", ALLOWED)).toBe(true);
    expect(toolBlockOk(result(), "user", ALLOWED)).toBe(true);
    expect(toolBlockOk(result({ is_error: true }), "user", ALLOWED)).toBe(true);
  });

  it("refuses the wrong role", () => {
    expect(toolBlockOk(use(), "user", ALLOWED)).toBe(false);
    expect(toolBlockOk(result(), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(use(), undefined, ALLOWED)).toBe(false);
  });

  it("refuses everything when the request named no tools, so history cannot smuggle a tool in", () => {
    expect(toolBlockOk(use(), "assistant", new Set())).toBe(false);
    expect(toolBlockOk(result(), "user", new Set())).toBe(false);
  });

  it("refuses a tool the request did not offer, even though it is a real one", () => {
    expect(toolBlockOk(use({ name: "recall_facts" }), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(use({ name: "run_query" }), "assistant", ALLOWED)).toBe(false);
  });

  it("checks ids, inputs and results are the shapes the provider sends", () => {
    expect(toolBlockOk(use({ id: "short" }), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(use({ id: "bad id with spaces" }), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(use({ id: undefined }), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(use({ input: "query=plumber" }), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(use({ input: [1] }), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(use({ input: null }), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(result({ tool_use_id: "x" }), "user", ALLOWED)).toBe(false);
    expect(toolBlockOk(result({ content: { ok: true } }), "user", ALLOWED)).toBe(false);
    expect(toolBlockOk(result({ is_error: "yes" }), "user", ALLOWED)).toBe(false);
  });

  it("bounds sizes, in bytes", () => {
    expect(toolBlockOk(use({ input: { query: "x".repeat(MAX_TOOL_INPUT_BYTES) } }), "assistant", ALLOWED)).toBe(false);
    expect(toolBlockOk(result({ content: "x".repeat(MAX_TOOL_RESULT_BYTES) }), "user", ALLOWED)).toBe(true);
    expect(toolBlockOk(result({ content: "x".repeat(MAX_TOOL_RESULT_BYTES + 1) }), "user", ALLOWED)).toBe(false);
    // Three bytes a character: the same number of characters is three times the weight.
    expect(toolBlockOk(result({ content: "…".repeat(MAX_TOOL_RESULT_BYTES / 3 + 1) }), "user", ALLOWED)).toBe(false);
    expect(utf8Bytes("…")).toBe(3);
  });

  it("does not judge a block that is not a tool block", () => {
    expect(toolBlockOk({ type: "text", text: "hi" }, "user", ALLOWED)).toBe(false);
    expect(toolBlockOk({ type: "image" }, "user", ALLOWED)).toBe(false);
  });
});

describe("shapeReply: what leaves the proxy", () => {
  it("returns the words and the calls, in order", () => {
    const r = shapeReply([
      { type: "text", text: "Let me look. " },
      { type: "tool_use", id: "toolu_aaaaaaaa", name: "search_items", input: { query: "a" } },
      { type: "text", text: "And the schedule." },
      { type: "tool_use", id: "toolu_bbbbbbbb", name: "get_schedule", input: { from: "2026-10-26", to: "2026-10-26" } },
    ], ALLOWED);
    expect(r.text).toBe("Let me look. And the schedule.");
    expect(r.toolCalls.map((c) => c.name)).toEqual(["search_items", "get_schedule"]);
  });

  it("drops a call to a tool this request did not offer, or with a bad id or input", () => {
    const r = shapeReply([
      { type: "tool_use", id: "toolu_aaaaaaaa", name: "recall_facts", input: {} },
      { type: "tool_use", id: "x", name: "search_items", input: {} },
      { type: "tool_use", id: "toolu_cccccccc", name: "search_items", input: "no" },
      { type: "tool_use", id: "toolu_dddddddd", name: "search_items", input: { query: "ok" } },
    ], ALLOWED);
    expect(r.toolCalls).toEqual([{ id: "toolu_dddddddd", name: "search_items", input: { query: "ok" } }]);
  });

  it("returns at most four calls, so the conversation the app carries stays whole", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ type: "tool_use", id: `toolu_${String(i).padStart(8, "0")}`, name: "search_items", input: { query: String(i) } }));
    expect(shapeReply(many, ALLOWED).toolCalls).toHaveLength(MAX_TOOL_USE_PER_REPLY);
  });

  it("an empty or missing reply is empty, not an error", () => {
    expect(shapeReply(undefined, ALLOWED)).toEqual({ text: "", toolCalls: [] });
    expect(shapeReply([], ALLOWED)).toEqual({ text: "", toolCalls: [] });
  });
});
