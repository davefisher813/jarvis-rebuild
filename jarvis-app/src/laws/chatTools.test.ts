import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TOOL_NAMES, TOOL_REGISTRY } from "../chat/tools/registry";

// LAW: THE MODEL'S HANDS ARE A CLOSED MENU, AND ONLY THE DISPATCHER ACTS (Dave's chat box order, 2026-10-24).
//
// "No generic escape-hatch tools. One of those makes every other rule decorative." The rest of the order (reads free, writes ask, chat
// never sends, ids only from searches) holds only while the model can reach nothing but the tools below, through the one dispatcher, and
// that dispatcher can reach nothing it was not handed. Each rule here is a thing that, once broken, would let a model act outside the
// others, and none of them is visible in a screenshot.
//
// This phase is READS ONLY. When write tools arrive (tier 1 to 3) the roster below is edited on purpose, in the same change that adds the
// approval path, and the read-only tripwire at the bottom is replaced by that path's own law. A change to this file is a decision.

const SRC = join(__dirname, "..");
const TOOLS_DIR = join(SRC, "chat", "tools");
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => p.slice(SRC.length + 1);

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}
const toolFiles = walk(TOOLS_DIR);
const allFiles = walk(SRC).filter((f) => !/\/(bench|testpanel|laws)\//.test(f));

// The menu, as of 2026-10-24. Reads only.
const ROSTER = ["search_items", "read_document", "get_schedule", "search_email", "recall_facts", "get_activity"];

// A tool called any of these is a way to do anything.
const ESCAPE_HATCH = /(^|_)(run|exec|execute|eval|call|fetch|http|request|sql|query|shell|bash|api|raw|any|generic|invoke|script|code)(_|$)/;

describe("the menu is closed", () => {
  it("is exactly the roster: a new tool is a decision made here, in a law, not a line added somewhere", () => {
    expect([...TOOL_NAMES]).toEqual(ROSTER);
  });

  it("holds no tool named like an escape hatch (run_query, call_api, execute, fetch_url, eval, shell)", () => {
    for (const n of TOOL_NAMES) expect(ESCAPE_HATCH.test(n), n).toBe(false);
    // And the pattern itself still catches what it is for, so this rule cannot rot into a rule that matches nothing.
    for (const bad of ["run_query", "call_api", "execute", "fetch_url", "eval", "sql", "shell_exec", "http_request"]) expect(ESCAPE_HATCH.test(bad), bad).toBe(true);
  });

  it("gives every tool a closed, bounded input: no free-form object, no unbounded text, no unbounded list or number", () => {
    const check = (name: string, path: string, s: Record<string, unknown>) => {
      const type = s.type;
      expect(["object", "string", "integer", "number", "boolean", "array"], `${name} ${path} has a type this layer reads`).toContain(type);
      if (type === "object") {
        expect(s.additionalProperties, `${name} ${path} is closed`).toBe(false);
        for (const [k, v] of Object.entries((s.properties ?? {}) as Record<string, Record<string, unknown>>)) check(name, `${path}.${k}`, v);
      }
      if (type === "string") expect(s.maxLength !== undefined || s.pattern !== undefined || s.enum !== undefined, `${name} ${path} text is bounded`).toBe(true);
      if (type === "array") {
        expect(s.maxItems, `${name} ${path} list is bounded`).toBeTypeOf("number");
        check(name, `${path}[]`, s.items as Record<string, unknown>);
      }
      if (type === "integer" || type === "number") {
        expect(s.minimum, `${name} ${path} has a floor`).toBeTypeOf("number");
        expect(s.maximum, `${name} ${path} has a ceiling`).toBeTypeOf("number");
      }
    };
    for (const n of TOOL_NAMES) check(n, "input", TOOL_REGISTRY[n].input_schema);
  });

  it("the proxy attaches the tools from the registry and never from the request body", () => {
    const proxy = read(join(SRC, "..", "api", "ai.ts"));
    expect(proxy).toMatch(/wireTools\(body\.tools\)/);
    expect(proxy).toMatch(/tools: toolList/);
    expect(proxy).not.toMatch(/tools:\s*body\.tools/);
    expect(proxy).not.toMatch(/\.\.\.\s*\(?body\.tools/);
  });
});

describe("only the dispatcher acts", () => {
  const importersOf = (needle: RegExp) => allFiles.filter((f) => needle.test(read(f))).map(rel).sort();

  it("the read implementations are built in one place: the hook that wires the chat's services", () => {
    expect(importersOf(/from "\.\/readTools"|from "\.\.\/chat\/tools\/readTools"|from "\.\/tools\/readTools"/)).toEqual(["chat/tools/useChatTools.ts"]);
  });

  it("a tool call is dispatched in one place: the turn loop", () => {
    // Whoever imports the `dispatch` function itself (the module's other exports are types and constants).
    expect(importersOf(/import\s*\{[^}]*\bdispatch\b[^}]*\}\s*from\s*"[^"]*\/dispatcher"/)).toEqual(["chat/tools/turn.ts"]);
  });

  it("the chat screen reaches the tools only through the hook and the turn's own answer, never the dispatcher or the reads", () => {
    const chat = read(join(SRC, "chat", "ChatFlow.tsx"));
    expect(chat).not.toMatch(/tools\/(dispatcher|readTools)"/);
    expect(chat).toMatch(/from "\.\/tools\/useChatTools"/);
  });

  it("nothing in the tool layer can call the model itself, so a tool result can never start a second conversation", () => {
    for (const f of toolFiles) {
      const imports = [...read(f).matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);
      expect(imports.filter((i) => /ai\/(AIService|useAI)$/.test(i)), rel(f)).toEqual([]);
    }
  });
});

describe("this phase can only read (replaced by the approval path's own law when writes arrive)", () => {
  it("the read tools import no service, store or hook: they are handed plain functions and nothing else", () => {
    const imports = [...read(join(TOOLS_DIR, "readTools.ts")).matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);
    for (const i of imports) {
      expect(/Service|NotesProvider|data\/|\/store|useAI|supabase|shared\/guard/.test(i), `readTools imports ${i}`).toBe(false);
    }
  });

  it("the wiring hook calls no write on any service it holds", () => {
    const src = read(join(TOOLS_DIR, "useChatTools.ts"));
    const writes = [...src.matchAll(/\.\s*(create\w*|update\w*|delete\w*|remove\w*|add\w*|set[A-Z]\w*|complete(?!Turn)\w*|toggle\w*|append|clearAll|save\w*|put\w*|restore\w*|recreate\w*)\(/g)].map((m) => m[0]);
    expect(writes).toEqual([]);
  });

  it("every registered tool is a read", () => {
    for (const n of TOOL_NAMES) expect(TOOL_REGISTRY[n].tier, n).toBe(0);
  });
});
