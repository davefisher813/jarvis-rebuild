// WHAT A TOOL CALL LOOKS LIKE ON THE WIRE (chat box order, 2026-10-24). Pure and shared: the proxy checks every tool block that arrives
// and shapes every reply that leaves with these, and the app builds the same blocks, so both ends hold one definition.
//
// The proxy stays stateless. A tool turn is a conversation the APP carries: it sends the messages so far plus the names of the tools it
// wants, the proxy returns the model's text and any tool calls, the app's dispatcher runs them, and the next request carries what they
// returned as tool_result blocks. Nothing here runs a tool. A tool_use block is the model asking; only the dispatcher acts.
//
// Every block is bounded here, because this is the door a hostile body would use:
//   - a tool_use may appear only in an assistant message and a tool_result only in a user one;
//   - only a tool NAMED on this request may be used or answered, so history cannot smuggle in a tool the request did not offer;
//   - ids are the provider's own shape, an input is a plain object under a size, a result is a string under a size.

import type { ToolName } from "./registry";

/** One call the model asked for, after the proxy has checked it. */
export interface ToolCall {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
}

export const MAX_TOOL_USE_PER_REPLY = 4;
export const MAX_TOOL_INPUT_BYTES = 2000;
export const MAX_TOOL_RESULT_BYTES = 6000;

const ID = /^[A-Za-z0-9_-]{8,64}$/;

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function plainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Is this tool_use or tool_result block acceptable in a message of this role, given the tools this request names? Anything else about
 * a block (text, an image) is the proxy's own check; this only judges the two tool kinds, and says no to a kind it does not know.
 */
export function toolBlockOk(blk: Record<string, unknown>, role: unknown, allowed: ReadonlySet<string>): boolean {
  if (allowed.size === 0) return false;
  if (blk.type === "tool_use") {
    if (role !== "assistant") return false;
    if (typeof blk.id !== "string" || !ID.test(blk.id)) return false;
    if (typeof blk.name !== "string" || !allowed.has(blk.name)) return false;
    if (!plainObject(blk.input)) return false;
    return utf8Bytes(JSON.stringify(blk.input)) <= MAX_TOOL_INPUT_BYTES;
  }
  if (blk.type === "tool_result") {
    if (role !== "user") return false;
    if (typeof blk.tool_use_id !== "string" || !ID.test(blk.tool_use_id)) return false;
    if (typeof blk.content !== "string" || utf8Bytes(blk.content) > MAX_TOOL_RESULT_BYTES) return false;
    return blk.is_error === undefined || typeof blk.is_error === "boolean";
  }
  return false;
}

export interface Reply {
  text: string;
  toolCalls: ToolCall[];
}

interface ReplyBlock { type?: string; text?: string; id?: string; name?: string; input?: unknown }

/**
 * The model's reply as the app receives it: its words, and the calls it asked for. A call that names a tool this request did not offer,
 * carries an id of the wrong shape or an input that is not a plain object is dropped here rather than forwarded, and so are the calls
 * past the fourth: the app answers exactly the calls it was shown, so the conversation it carries stays whole.
 */
export function shapeReply(content: ReplyBlock[] | undefined, allowed: ReadonlySet<string>): Reply {
  const blocks = content ?? [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const toolCalls: ToolCall[] = [];
  for (const b of blocks) {
    if (b.type !== "tool_use" || toolCalls.length >= MAX_TOOL_USE_PER_REPLY) continue;
    if (typeof b.id !== "string" || !ID.test(b.id) || typeof b.name !== "string" || !allowed.has(b.name) || !plainObject(b.input)) continue;
    toolCalls.push({ id: b.id, name: b.name as ToolName, input: b.input });
  }
  return { text, toolCalls };
}
