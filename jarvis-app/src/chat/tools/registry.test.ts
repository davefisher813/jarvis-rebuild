import { describe, it, expect } from "vitest";
import { MAX_WIRE_TOOLS, REF_PATTERN, TOOL_NAMES, TOOL_REGISTRY, isToolName, wireTools } from "./registry";
import { validateInput } from "./validate";

// THE MENU (chat box order, 2026-10-24). The model is offered tools by name from this registry and nowhere else; these hold the registry
// itself to its shape and the wire list to what the proxy may build from it.

describe("the registry", () => {
  it("defines every name it lists, once, under its own name", () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    for (const n of TOOL_NAMES) expect(TOOL_REGISTRY[n].name, n).toBe(n);
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it("this phase offers reads only: every registered tool is tier 0", () => {
    for (const n of TOOL_NAMES) expect(TOOL_REGISTRY[n].tier, n).toBe(0);
  });

  it("every tool says what it does, says what it is doing while it runs, and takes a closed object", () => {
    for (const n of TOOL_NAMES) {
      const d = TOOL_REGISTRY[n];
      expect(d.description.length, n).toBeGreaterThan(40);
      expect(d.working, n).toMatch(/^[A-Z][^.]*[^.]$/); // one fragment, no full stop
      expect(d.input_schema.type, n).toBe("object");
      expect(d.input_schema.additionalProperties, n).toBe(false);
    }
  });

  it("a ref is a kind and an id, and nothing a model could not have been handed", () => {
    const re = new RegExp(REF_PATTERN);
    expect(re.test("task:abc-123_X")).toBe(true);
    expect(re.test("thread:18f3a")).toBe(true);
    for (const bad of ["task", "task:", ":abc", "tasks:abc", "task:a b", "task:abc:def", "TASK:abc", "task:" + "a".repeat(81), "task:../../etc"]) {
      expect(re.test(bad), bad).toBe(false);
    }
  });

  it("recognises its own names and nothing else", () => {
    expect(isToolName("search_items")).toBe(true);
    for (const bad of ["run_query", "constructor", "__proto__", "", 7, null, undefined]) expect(isToolName(bad), String(bad)).toBe(false);
  });
});

describe("wireTools: what the proxy may build the provider's list from", () => {
  it("gives the definition for each name, in the order asked, and only name, description and schema", () => {
    const list = wireTools(["get_schedule", "search_items"])!;
    expect(list.map((t) => t.name)).toEqual(["get_schedule", "search_items"]);
    expect(Object.keys(list[0]!).sort()).toEqual(["description", "input_schema", "name"]);
    expect(list[1]!.input_schema).toBe(TOOL_REGISTRY.search_items.input_schema);
  });

  it("refuses the whole list when anything is not on the menu", () => {
    expect(wireTools(["search_items", "run_query"])).toBeNull();
    expect(wireTools(["search_items", "search_items"])).toBeNull();
    expect(wireTools([])).toBeNull();
    expect(wireTools("search_items")).toBeNull();
    expect(wireTools({ 0: "search_items", length: 1 })).toBeNull();
    expect(wireTools([{ name: "search_items" }])).toBeNull();
  });

  it("is short: a list longer than the limit is refused even when every name is real", () => {
    expect(MAX_WIRE_TOOLS).toBeGreaterThanOrEqual(TOOL_NAMES.length);
    expect(wireTools(new Array(MAX_WIRE_TOOLS + 1).fill("search_items"))).toBeNull();
  });

  it("every tool in the menu accepts a plain valid call under its own schema", () => {
    const fine: Record<string, Record<string, unknown>> = {
      search_items: { query: "plumber" },
      read_document: { ref: "note:abc-123" },
      get_schedule: { from: "2026-10-26", to: "2026-10-30" },
      search_email: { query: "invoice", limit: 3 },
      recall_facts: { query: "dentist" },
      get_activity: {},
    };
    for (const n of TOOL_NAMES) expect(validateInput(TOOL_REGISTRY[n].input_schema, fine[n]), n).toBeNull();
  });
});
