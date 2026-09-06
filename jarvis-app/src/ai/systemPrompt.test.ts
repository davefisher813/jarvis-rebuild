import { describe, it, expect } from "vitest";
import { wireSystem, systemPayload, flattenSystem, CACHEABLE_MIN_CHARS } from "./systemPrompt";

// UP-PLAT-02 (2026-09-06): "Cache the user's context block so repeat AI calls
// cost a tenth." Every AI call shipped the same 16 KB assembler's output as
// part of a feature-specific system string and paid full input price for it
// every time. These pin the two halves of the fix: the client only marks a
// block worth caching, and the proxy puts the context FIRST with the
// breakpoint on it, because a cache covers the prefix before the mark.

const BIG = "x".repeat(CACHEABLE_MIN_CHARS);
const SMALL = "x".repeat(CACHEABLE_MIN_CHARS - 1);

describe("what the client puts on the wire", () => {
  it("a plain string is untouched, exactly as before this existed", () => {
    expect(wireSystem("just a prompt")).toBe("just a prompt");
    expect(wireSystem(undefined)).toBeUndefined();
  });

  it("a context big enough to cache stays split", () => {
    const w = wireSystem({ context: BIG, instructions: "Task: sort." });
    expect(typeof w).toBe("object");
    expect((w as { context: string }).context).toBe(BIG);
  });

  it("a context too small to cache is flattened, so no cache write is paid for nothing", () => {
    // Below the model's 1,024-token floor the mark is ignored and a write
    // costs 1.25x, so a brand new account with three tasks sends one string.
    const w = wireSystem({ context: SMALL, instructions: "Task: sort." });
    expect(typeof w).toBe("string");
    expect(w).toBe(SMALL + "\nTask: sort.");
  });

  it("flattening keeps the context first, so both paths send the same order", () => {
    expect(flattenSystem({ context: "CTX", instructions: "DO" })).toBe("CTX\nDO");
    expect(flattenSystem({ context: "", instructions: "DO" })).toBe("DO");
  });
});

describe("what the proxy sends upstream", () => {
  it("marks the context block, and only the context block", () => {
    const p = systemPayload({ context: "CTX", instructions: "DO" })!;
    expect(p.system).toEqual([
      { type: "text", text: "CTX", cache_control: { type: "ephemeral" } },
      { type: "text", text: "DO" },
    ]);
  });

  it("the context is the prefix: a cache breakpoint covers what is in front of it", () => {
    const blocks = systemPayload({ context: "CTX", instructions: "DO" })!.system as { text: string }[];
    expect(blocks[0]!.text).toBe("CTX");
  });

  it("a plain string still goes as a plain string", () => {
    expect(systemPayload("hello")).toEqual({ system: "hello" });
  });

  it("no system prompt means no system key, same as before", () => {
    expect(systemPayload(undefined)).toBeNull();
    expect(systemPayload("")).toBeNull();
    expect(systemPayload({ context: "", instructions: "" })).toBeNull();
  });

  it("an empty context is one instruction string: nothing to cache", () => {
    expect(systemPayload({ context: "   ", instructions: "DO" })).toEqual({ system: "DO" });
  });

  it("a malformed system from a hostile or stale client is dropped, never forwarded", () => {
    expect(systemPayload({ context: 5, instructions: "DO" })).toBeNull();
    expect(systemPayload({ instructions: "DO" })).toBeNull();
    expect(systemPayload([{ type: "text", text: "sneaky" }])).toBeNull();
    expect(systemPayload(null)).toBeNull();
  });
});
