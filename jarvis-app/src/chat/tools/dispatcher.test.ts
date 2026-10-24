import { describe, it, expect, vi } from "vitest";
import {
  MAX_CALLS_PER_TURN, RESULT_BYTES, TURN_RESULT_BYTES, ToolFailure, boundedJson, dispatch, newBudget, refFields,
  type DispatchDeps, type ToolContext, type ToolImpl,
} from "./dispatcher";
import { REFUSAL_TEXT } from "./toolPrompt";
import { TOOL_REGISTRY, REF_PATTERN, type ToolDef } from "./registry";
import { utf8Bytes, type ToolCall } from "./wire";

// THE DISPATCHER (chat box order, 2026-10-24): "the model proposes; only the dispatcher acts". Five checks in code, in a fixed order, and
// every no is a tool_result the model can read.

const NOW = new Date("2026-10-26T15:00:00.000Z");
const call = (name: string, input: Record<string, unknown>, id = "toolu_00000001"): ToolCall => ({ id, name: name as ToolCall["name"], input });
const ctx = (seen: string[] = []): ToolContext => ({ seen: new Set(seen), now: NOW });
const body = (o: { content: string }) => JSON.parse(o.content) as Record<string, unknown>;

const found: ToolImpl = async () => ({ data: { items: [{ ref: "task:t1", title: "Call the plumber" }] }, refs: [{ kind: "task", id: "t1", label: "Call the plumber" }] });

function deps(over: Partial<DispatchDeps> = {}): DispatchDeps {
  return { impls: { search_items: found }, ctx: ctx(), budget: newBudget(), ...over };
}

describe("a read that is allowed", () => {
  it("runs, comes back as data stamped with when it was read, and hands its records to the seen set", async () => {
    const d = deps();
    const o = await dispatch(call("search_items", { query: "plumber" }), d);
    expect(o.state).toBe("ran");
    expect(o.isError).toBe(false);
    expect(body(o)).toEqual({ ok: true, items: [{ ref: "task:t1", title: "Call the plumber" }], asOf: NOW.toISOString() });
    expect(o.refs).toEqual([{ kind: "task", id: "t1", label: "Call the plumber" }]);
    expect(d.ctx.seen.has("task:t1")).toBe(true);
    expect(d.budget.calls).toBe(1);
  });
});

describe("check 1: the name", () => {
  it("refuses a tool that is not on the menu, with what to do instead", async () => {
    for (const name of ["run_query", "call_api", "constructor", "__proto__", ""]) {
      const o = await dispatch(call(name, {}), deps());
      expect(o.state, name).toBe("refused");
      expect(o.code, name).toBe("unknown_tool");
      expect(o.isError).toBe(true);
      expect(body(o).error).toEqual({ code: "unknown_tool", message: REFUSAL_TEXT.unknown_tool });
    }
  });

  it("does not run an implementation it was never handed", async () => {
    const o = await dispatch(call("get_activity", {}), deps());
    expect(o.state).toBe("refused");
    expect(o.code).toBe("not_available");
  });
});

describe("check 2: the turn's budget", () => {
  it("refuses once the call cap is spent, and says to answer now", async () => {
    const d = deps();
    d.budget.calls = MAX_CALLS_PER_TURN;
    const o = await dispatch(call("search_items", { query: "x" }), d);
    expect(o.code).toBe("cap");
    expect(body(o).error).toEqual({ code: "cap", message: REFUSAL_TEXT.cap });
    expect(d.budget.calls).toBe(MAX_CALLS_PER_TURN);
  });

  it("refuses once the bytes already returned reach the turn's ceiling", async () => {
    const d = deps();
    d.budget.bytes = TURN_RESULT_BYTES;
    expect((await dispatch(call("search_items", { query: "x" }), d)).code).toBe("cap");
  });

  it("checks the budget before the input, so a spent turn cannot be kept busy by bad calls", async () => {
    const d = deps();
    d.budget.calls = MAX_CALLS_PER_TURN;
    expect((await dispatch(call("search_items", {}), d)).code).toBe("cap");
  });

  it("counts a call only when it actually runs", async () => {
    const d = deps();
    await dispatch(call("search_items", {}), d); // refused: bad input
    await dispatch(call("run_query", {}), d); // refused: unknown
    expect(d.budget.calls).toBe(0);
    await dispatch(call("search_items", { query: "x" }), d);
    expect(d.budget.calls).toBe(1);
  });
});

describe("check 3: the input", () => {
  it("refuses an input that breaks the schema, with the reason, and never runs it", async () => {
    const impl = vi.fn(found);
    const o = await dispatch(call("search_items", { query: "x", limit: 99 }), deps({ impls: { search_items: impl } }));
    expect(o.code).toBe("bad_input");
    expect((body(o).error as { message: string }).message).toBe("The input was not accepted: input.limit is too large.");
    expect(impl).not.toHaveBeenCalled();
  });
});

describe("check 4: the ids", () => {
  const read: ToolImpl = vi.fn(async () => ({ data: { text: "hello" } }));

  it("refuses a ref no search returned, so a record cannot be invented or guessed", async () => {
    const o = await dispatch(call("read_document", { ref: "note:abc123" }), deps({ impls: { read_document: read } }));
    expect(o.code).toBe("unseen_ref");
    expect(body(o).error).toEqual({ code: "unseen_ref", message: REFUSAL_TEXT.unseen_ref });
    expect(read).not.toHaveBeenCalled();
  });

  it("accepts one a search in this conversation returned", async () => {
    const d = deps({ impls: { read_document: read }, ctx: ctx(["note:abc123"]) });
    expect((await dispatch(call("read_document", { ref: "note:abc123" }), d)).state).toBe("ran");
  });

  it("learns refs from one call and honours them in the next", async () => {
    const search: ToolImpl = async () => ({ data: { items: [] }, refs: [{ kind: "note", id: "n9", label: "Roster" }] });
    const d = deps({ impls: { search_items: search, read_document: read } });
    expect((await dispatch(call("read_document", { ref: "note:n9" }), d)).code).toBe("unseen_ref");
    await dispatch(call("search_items", { query: "roster" }), d);
    expect((await dispatch(call("read_document", { ref: "note:n9" }), d)).state).toBe("ran");
  });

  it("finds ref fields from the schema itself, including a list of refs", () => {
    expect(refFields(TOOL_REGISTRY.read_document.input_schema)).toEqual(["ref"]);
    expect(refFields(TOOL_REGISTRY.search_items.input_schema)).toEqual([]);
    expect(refFields({ type: "object", properties: { a: { pattern: REF_PATTERN }, b: { type: "array", items: { pattern: REF_PATTERN } }, c: { type: "string" } } })).toEqual(["a", "b"]);
  });

  it("holds a future tool with a list of refs to the same rule", async () => {
    const registry: Record<string, ToolDef> = {
      pair: {
        name: "pair" as never, tier: 0, working: "Pairing", description: "x".repeat(50),
        input_schema: { type: "object", properties: { refs: { type: "array", maxItems: 3, items: { type: "string", pattern: REF_PATTERN } } }, required: ["refs"], additionalProperties: false },
      },
    };
    const o = await dispatch(call("pair", { refs: ["task:a", "task:b"] }), deps({ registry, ctx: ctx(["task:a"]) }));
    expect(o.code).toBe("unseen_ref");
  });
});

describe("check 5: the tier", () => {
  const registry: Record<string, ToolDef> = Object.fromEntries([1, 2, 3].map((tier) => [
    `tool_${tier}`,
    { name: `tool_${tier}` as never, tier: tier as 1 | 2 | 3, working: "Doing it", description: "x".repeat(50), input_schema: { type: "object", properties: {}, additionalProperties: false } },
  ]));

  it("never runs anything above a read on this path, even with an implementation sitting there", async () => {
    const impl = vi.fn(found);
    for (const name of ["tool_1", "tool_2", "tool_3"]) {
      const o = await dispatch(call(name, {}), { impls: { search_items: impl, [name]: impl } as never, ctx: ctx(), budget: newBudget(), registry });
      expect(o.state, name).toBe("refused");
      expect(o.code, name).toBe("not_available");
      expect(body(o).error).toEqual({ code: "not_available", message: REFUSAL_TEXT.not_available });
    }
    expect(impl).not.toHaveBeenCalled();
  });

  it("the registry this phase ships offers nothing above a read to run", () => {
    for (const d of Object.values(TOOL_REGISTRY)) expect(d.tier).toBe(0);
  });
});

describe("a read that fails", () => {
  it("passes on only the words an implementation chose, as a failed outcome the model can read", async () => {
    const nomail: ToolImpl = async () => { throw new ToolFailure("no_mail", "No mail account is connected."); };
    const o = await dispatch(call("search_email", { query: "x" }), deps({ impls: { search_email: nomail } }));
    expect(o.state).toBe("failed");
    expect(o.code).toBe("no_mail");
    expect(o.isError).toBe(true);
    expect(body(o).error).toEqual({ code: "no_mail", message: "No mail account is connected." });
  });

  it("never lets a raw error through: a thrown message could carry a record's text", async () => {
    const boom: ToolImpl = async () => { throw new Error("select * from item where data like '%Dave salary 180000%'"); };
    const o = await dispatch(call("search_items", { query: "x" }), deps({ impls: { search_items: boom } }));
    expect(o.state).toBe("failed");
    expect(o.content).not.toContain("salary");
    expect(body(o).error).toEqual({ code: "failed", message: REFUSAL_TEXT.failed });
  });

  it("does not throw to its caller", async () => {
    const boom: ToolImpl = async () => { throw "not even an Error"; };
    await expect(dispatch(call("search_items", { query: "x" }), deps({ impls: { search_items: boom } }))).resolves.toMatchObject({ state: "failed" });
  });
});

describe("what comes back is bounded", () => {
  const big = (n: number): ToolImpl => async () => ({ data: { items: Array.from({ length: n }, (_, i) => ({ ref: `task:t${i}`, title: "x".repeat(200) })) } });

  it("fits one call's result, dropping items from the end and saying so", async () => {
    const o = await dispatch(call("search_items", { query: "x" }), deps({ impls: { search_items: big(100) } }));
    expect(utf8Bytes(o.content)).toBeLessThanOrEqual(RESULT_BYTES);
    const b = body(o);
    expect(b.truncated).toBe(true);
    expect((b.items as unknown[]).length).toBeGreaterThan(0);
    expect((b.items as unknown[]).length).toBeLessThan(100);
  });

  it("fits what is left of the turn's ceiling, so the whole turn cannot flood the context", async () => {
    const d = deps({ impls: { search_items: big(100) } });
    for (let i = 0; i < 6; i++) await dispatch(call("search_items", { query: "x" }, `toolu_0000000${i}`), d);
    expect(d.budget.bytes).toBeLessThanOrEqual(TURN_RESULT_BYTES + 256);
  });

  it("cuts a long text and marks it, rather than breaking the JSON", () => {
    const s = boundedJson({ ok: true, text: "word ".repeat(2000) }, 500);
    expect(utf8Bytes(s)).toBeLessThanOrEqual(500);
    const parsed = JSON.parse(s) as { truncated: boolean; text: string };
    expect(parsed.truncated).toBe(true);
    expect(parsed.text.length).toBeGreaterThan(40);
  });

  it("measures bytes, not characters", () => {
    const s = boundedJson({ ok: true, items: Array.from({ length: 50 }, () => "…".repeat(40)) }, 600);
    expect(utf8Bytes(s)).toBeLessThanOrEqual(600);
  });

  it("replaces what it cannot trim with a plain note", () => {
    const s = boundedJson({ ok: true, blob: "x".repeat(5000) }, 300);
    expect(JSON.parse(s)).toEqual({ ok: true, truncated: true, note: "The result was too large to return." });
  });

  it("leaves a result that already fits exactly as it is", () => {
    expect(boundedJson({ ok: true, items: [1, 2] }, 500)).toBe('{"ok":true,"items":[1,2]}');
  });
});
