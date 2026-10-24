// THE DISPATCHER: THE ONLY THING IN CHAT THAT ACTS ON A TOOL CALL (chat box order, 2026-10-24: "the model proposes; only the dispatcher acts").
//
// A tool_use block is the model ASKING. Everything that decides whether the ask is honoured lives here, in code, where a prompt cannot
// talk it out of anything. Five checks, in this order:
//
//   1. THE NAME is on the menu (registry.ts), or the call is refused.
//   2. THE BUDGET for the turn is not spent: calls, and bytes already returned.
//   3. THE INPUT passes the tool's own schema (validate.ts), or the call is refused with the reason.
//   4. THE IDS are ones this conversation was handed. Any field shaped like a ref must be a ref a search in this chat already returned
//      (`seen`). The model cannot invent a record, and cannot point at one it never found: it searches first.
//   5. THE TIER decides what may run. Tier 0 reads run. Everything above it is refused here with the reason, because a write needs the
//      person's tap on its exact content and a send is never the agent's to dispatch; those paths are not this one.
//
// What a tool returns is bounded before the model sees it (RESULT_BYTES a call, TURN_RESULT_BYTES a turn), so one big note or one hostile
// mailbox cannot flood the context.
//
// Every refusal is a tool_result the model can read (with is_error), never a silent drop, so it learns to ask a different way. Nothing
// here throws to its caller: a tool that fails comes back as a failed outcome, with no raw error text (that could carry a record).
//
// What a tool returns is DATA. The text of a note, a pasted page or a stranger's email never becomes an instruction: the reads that carry
// outside text fence it (readTools.ts) and the system prompt says so; this module only guarantees it arrives bounded, as JSON, labelled
// with when it was read.

import { TOOL_REGISTRY, REF_PATTERN, isToolName, type ToolDef, type ToolName, type ToolSchema } from "./registry";
import { validateInput } from "./validate";
import { REFUSAL_TEXT } from "./toolPrompt";
import { utf8Bytes, type ToolCall } from "./wire";

/** Model calls in one turn. The last one must answer: it is shown no further results. */
export const MAX_STEPS = 5;
/** Tool calls the dispatcher will run in one turn, across every step. */
export const MAX_CALLS_PER_TURN = 8;
/** One call's result, as the model sees it. */
export const RESULT_BYTES = 4096;
/** Every result in one turn together. */
export const TURN_RESULT_BYTES = 16384;

/** A record a tool returned: it joins the seen set, and may become a provenance chip when the answer names it. */
export interface RecordRef {
  kind: string;
  id: string;
  label: string;
}

/** What an implementation hands back. `data` becomes the result's body; `refs` are the records in it. */
export interface ToolRun {
  data: Record<string, unknown>;
  refs?: RecordRef[];
}

export interface ToolContext {
  /** `kind:id` of every record a tool has returned in this conversation. The only valid ids. */
  seen: Set<string>;
  now: Date;
}

export type ToolImpl = (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolRun>;

/** A failure a person (and the model) may be told about in words. Anything else an implementation throws is reported as a plain failure. */
export class ToolFailure extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolFailure";
    this.code = code;
  }
}

export type ToolRefusal = "unknown_tool" | "not_available" | "bad_input" | "unseen_ref" | "cap";

export interface Outcome {
  call: ToolCall;
  /** ran: it returned data. refused: the dispatcher said no before running it. failed: it ran and could not answer. */
  state: "ran" | "refused" | "failed";
  /** Why, for a refusal or a failure. */
  code?: ToolRefusal | "failed" | string;
  /** What goes back to the model: a JSON string, already bounded. */
  content: string;
  isError: boolean;
  refs: RecordRef[];
}

/** What a turn has spent so far. One per turn; the dispatcher reads and advances it. */
export interface TurnBudget {
  calls: number;
  bytes: number;
}

export function newBudget(): TurnBudget {
  return { calls: 0, bytes: 0 };
}

export interface DispatchDeps {
  impls: Partial<Record<ToolName, ToolImpl>>;
  ctx: ToolContext;
  budget: TurnBudget;
  /** The menu. Tests pass their own to prove a tier-1 tool is refused; the app always uses the real one. */
  registry?: Record<string, ToolDef>;
}

/** The input fields of a schema that name a record (the ref pattern, alone or as a list's items). */
export function refFields(schema: ToolSchema): string[] {
  const props = (schema.properties ?? {}) as Record<string, { pattern?: unknown; items?: { pattern?: unknown } }>;
  return Object.entries(props)
    .filter(([, p]) => p.pattern === REF_PATTERN || p.items?.pattern === REF_PATTERN)
    .map(([k]) => k);
}

const outcome = (call: ToolCall, state: Outcome["state"], code: string | undefined, body: Record<string, unknown>, refs: RecordRef[] = []): Outcome => ({
  call,
  state,
  ...(code ? { code } : {}),
  content: JSON.stringify(body),
  isError: state !== "ran",
  refs,
});

function refuse(call: ToolCall, code: ToolRefusal, message: string): Outcome {
  return outcome(call, "refused", code, { ok: false, error: { code, message } });
}

/**
 * Run one call, or say why not. Never throws. See the header for the five checks and their order.
 */
export async function dispatch(call: ToolCall, d: DispatchDeps): Promise<Outcome> {
  const registry = d.registry ?? TOOL_REGISTRY;
  const def = Object.prototype.hasOwnProperty.call(registry, call.name) ? registry[call.name] : undefined;
  if (!def) return refuse(call, "unknown_tool", REFUSAL_TEXT.unknown_tool);

  if (d.budget.calls >= MAX_CALLS_PER_TURN || d.budget.bytes >= TURN_RESULT_BYTES) {
    return refuse(call, "cap", REFUSAL_TEXT.cap);
  }

  const bad = validateInput(def.input_schema, call.input);
  if (bad) return refuse(call, "bad_input", `The input was not accepted: ${bad}.`);

  // THE ID RULE. Every field shaped like a ref must be one this conversation was handed.
  for (const field of refFields(def.input_schema)) {
    const v = call.input[field];
    const refs = Array.isArray(v) ? v : v === undefined ? [] : [v];
    if (refs.some((r) => typeof r !== "string" || !d.ctx.seen.has(r))) {
      return refuse(call, "unseen_ref", REFUSAL_TEXT.unseen_ref);
    }
  }

  // THE TIER RULE. Only a read runs on this path.
  const impl = def.tier === 0 && isToolName(def.name) ? d.impls[def.name] : undefined;
  if (!impl) {
    return refuse(call, "not_available", REFUSAL_TEXT.not_available);
  }

  d.budget.calls += 1;
  let run: ToolRun;
  try {
    run = await impl(call.input, d.ctx);
  } catch (e) {
    // Only a failure the implementation chose to word is passed on. A raw error could carry a record's text, so it never is.
    if (e instanceof ToolFailure) return outcome(call, "failed", e.code, { ok: false, error: { code: e.code, message: e.message } });
    return outcome(call, "failed", "failed", { ok: false, error: { code: "failed", message: REFUSAL_TEXT.failed } });
  }

  const refs = (run.refs ?? []).slice(0, 50);
  for (const r of refs) d.ctx.seen.add(`${r.kind}:${r.id}`);
  const room = Math.max(256, Math.min(RESULT_BYTES, TURN_RESULT_BYTES - d.budget.bytes));
  const content = boundedJson({ ok: true, ...run.data, asOf: d.ctx.now.toISOString() }, room);
  d.budget.bytes += utf8Bytes(content);
  return { call, state: "ran", content, isError: false, refs };
}

/**
 * A result that fits. Drops items from the longest list one at a time, then cuts a long `text`, marking `truncated` so the model (and the
 * person, through it) knows it is not the whole of it. A result with nothing to trim is replaced by a plain "too large" note, never cut
 * into broken JSON.
 */
export function boundedJson(data: Record<string, unknown>, maxBytes: number): string {
  const cur: Record<string, unknown> = { ...data };
  let trimmed = false;
  for (let guard = 0; guard < 400; guard++) {
    const s = JSON.stringify(trimmed ? { ...cur, truncated: true } : cur);
    if (utf8Bytes(s) <= maxBytes) return s;
    const longest = Object.entries(cur)
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .sort((a, b) => (b[1] as unknown[]).length - (a[1] as unknown[]).length)[0];
    if (longest) {
      cur[longest[0]] = (longest[1] as unknown[]).slice(0, -1);
      trimmed = true;
      continue;
    }
    if (typeof cur.text === "string" && cur.text.length > 40) {
      cur.text = cur.text.slice(0, Math.floor(cur.text.length * 0.8));
      trimmed = true;
      continue;
    }
    break;
  }
  return JSON.stringify({ ok: true, truncated: true, note: "The result was too large to return." });
}
