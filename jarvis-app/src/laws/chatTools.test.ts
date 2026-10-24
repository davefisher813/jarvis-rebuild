import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { READ_TOOL_NAMES, TOOL_NAMES, TOOL_REGISTRY, WRITE_TOOL_NAMES } from "../chat/tools/registry";
import { makeProposers } from "../chat/tools/propose";

// LAW: THE MODEL'S HANDS ARE A CLOSED MENU, AND ONLY THE DISPATCHER ACTS (Dave's chat box order, 2026-10-24).
//
// "No generic escape-hatch tools. One of those makes every other rule decorative." The rest of the order (reads free, writes ask, chat
// never sends, ids only from searches) holds only while the model can reach nothing but the tools below, through the one dispatcher, and
// that dispatcher can reach nothing it was not handed. Each rule here is a thing that, once broken, would let a model act outside the
// others, and none of them is visible in a screenshot.
//
// The menu is six reads and three PROPOSALS (tier 1). A proposal is a card in the thread that shows the exact content; the change is made
// only by the person's tap, through one path (proposals.ts approves it, approval.ts runs it, execute.ts makes it), and the second half of
// this file holds that path to its shape. Tiers 2 and 3 (drafts, sends, deletes) are not on the menu: when they arrive the roster below is
// edited on purpose, in the same change that adds their path. A change to this file is a decision.

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

// The menu, as of 2026-10-24. Six reads, then three proposals.
const ROSTER = ["search_items", "read_document", "get_schedule", "search_email", "recall_facts", "get_activity", "create_task", "update_task", "capture_decision"];

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

const importersOf = (needle: RegExp) => allFiles.filter((f) => needle.test(read(f))).map(rel).sort();

describe("only the dispatcher acts", () => {
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

// ---- A WRITE HAPPENS ON A TAP, THROUGH ONE PATH ----

const nonTestToolFiles = toolFiles.filter((f) => !/\.test\./.test(f));
const valueImports = (f: string) => [...read(f).matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]!);
const OWN_THE_SERVICES = ["useChatTools.ts", "writeDeps.ts"];

describe("a write is a card, and the card is made real only by a tap", () => {
  it("the menu offers reads at tier 0 and proposals at tier 1, and nothing above", () => {
    for (const n of READ_TOOL_NAMES) expect(TOOL_REGISTRY[n].tier, n).toBe(0);
    for (const n of WRITE_TOOL_NAMES) expect(TOOL_REGISTRY[n].tier, n).toBe(1);
    expect(Math.max(...TOOL_NAMES.map((n) => TOOL_REGISTRY[n].tier))).toBe(1);
  });

  it("every write tool has a proposer, and a proposer for nothing else", () => {
    const proposers = makeProposers({ task: async () => null, person: async () => null });
    expect(Object.keys(proposers).sort()).toEqual([...WRITE_TOOL_NAMES].sort());
  });

  it("nothing but the tool layer's wiring and its one file of writes touches a service, a store or the network", () => {
    for (const f of nonTestToolFiles) {
      if (OWN_THE_SERVICES.includes(rel(f).split("/").pop()!)) continue;
      for (const i of valueImports(f)) {
        expect(/NotesProvider|TasksService|DecisionService|\/data\/|\/store|supabase|shared\/guard|useAI|AIService$/.test(i), `${rel(f)} imports ${i}`).toBe(false);
      }
    }
  });

  it("the read tools, the proposers, the dispatcher and the store cannot reach the code that writes", () => {
    for (const n of ["readTools.ts", "propose.ts", "dispatcher.ts", "proposals.ts", "turn.ts", "registry.ts", "turnWords.ts", "validate.ts", "wire.ts", "toolPrompt.ts"]) {
      for (const i of valueImports(join(TOOLS_DIR, n))) {
        expect(/\/(execute|approval|writeDeps)$/.test(i), `${n} imports ${i}`).toBe(false);
      }
    }
  });

  it("execute.ts is reached from approval.ts alone, and approval.ts and the writes from the hook alone", () => {
    // Types may be shared (writeDeps names the shape execute asks for); the code is reached from one place each.
    const code = (name: string) => new RegExp(`^import\\s+(?!type\\b)[^;]*?from\\s+"[^"]*\\/${name}"`, "m");
    expect(importersOf(code("execute"))).toEqual(["chat/tools/approval.ts"]);
    expect(importersOf(code("approval"))).toEqual(["chat/tools/useChatTools.ts"]);
    expect(importersOf(code("writeDeps"))).toEqual(["chat/tools/useChatTools.ts"]);
  });

  it("a proposal is executed in one place, and only after the store has accepted the tap", () => {
    const callers = allFiles.filter((f) => /\bexecuteProposal\(/.test(read(f)) && !/execute\.ts$/.test(f)).map(rel);
    expect(callers).toEqual(["chat/tools/approval.ts"]);
    const src = read(join(TOOLS_DIR, "approval.ts"));
    const accepted = src.indexOf(".approve(");
    const ran = src.indexOf("executeProposal(");
    expect(accepted).toBeGreaterThan(-1);
    expect(ran).toBeGreaterThan(accepted);
    // And the answer is checked in between: a no from the store returns before anything runs.
    expect(src.slice(accepted, ran)).toMatch(/if \(!verdict\.ok\) return/);
  });

  it("an approval is bound to a hash, a clock and a single use, in the store and nowhere else", () => {
    const src = read(join(TOOLS_DIR, "proposals.ts"));
    expect(src).toMatch(/async approve\(id: string, shownHash: string\)/);
    expect(src).toMatch(/shownHash !== p\.hash \|\| current !== p\.hash/);
    expect(src).toMatch(/this\.now\(\) >= p\.expiresAt/);
    expect(src).toMatch(/p\.state = "approved"/);
    // The state is only ever set to approved inside approve.
    expect(src.match(/state = "approved"/g)).toHaveLength(1);
    expect(src).toMatch(/hashPayload\(/);
    expect(read(join(SRC, "substrate", "canonical.ts"))).toMatch(/export function hashPayload/);
  });

  it("the screen reaches a write only by the card's button: one call to approve, made from the handler the card's tap is wired to", () => {
    const chat = read(join(SRC, "chat", "ChatFlow.tsx"));
    expect(chat.match(/tools\.approve\(/g)).toHaveLength(1);
    expect(chat.match(/const approveCard = async/g)).toHaveLength(1);
    expect(chat.match(/approveCard\(/g)).toHaveLength(1);
    expect(chat).toMatch(/onApprove=\{\(p\) => void approveCard\(p\)\}/);
    const cards = read(join(TOOLS_DIR, "ProposalCards.tsx"));
    // Every call of it (not its declaration in the props) sits inside a click.
    expect(cards.match(/onApprove\(p\)/g)!.length).toBe(cards.match(/onClick=\{\(\) => onApprove\(p\)/g)!.length);
  });

  it("the wiring hook itself calls no write on any service it holds", () => {
    const src = read(join(TOOLS_DIR, "useChatTools.ts"));
    const writes = [...src.matchAll(/\.\s*(create\w*|update\w*|delete\w*|remove\w*|add\w*|set[A-Z]\w*|complete(?!Turn)\w*|toggle\w*|append|clearAll|save\w*|put\w*|restore\w*|recreate\w*)\(/g)].map((m) => m[0]);
    expect(writes).toEqual([]);
  });

  it("the read tools are handed plain functions, never a service, so a read cannot reach a write", () => {
    for (const i of valueImports(join(TOOLS_DIR, "readTools.ts"))) {
      expect(/Service|NotesProvider|data\/|\/store|useAI|supabase|shared\/guard/.test(i), `readTools imports ${i}`).toBe(false);
    }
  });

  it("no text the model wrote reaches a write: a claim of a change is replaced, in code, by what the dispatcher did", () => {
    const chat = read(join(SRC, "chat", "ChatFlow.tsx"));
    expect(chat).toMatch(/claimsDone\(turn\.text\)/);
    expect(chat).toMatch(/notDoneLine\(proposed\)/);
  });
});
