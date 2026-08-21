// Forced structured outputs (queue item 12). When a caller supplies a JSON
// schema, the proxy turns the request into a forced tool call: Anthropic must
// answer by "using" a tool whose input_schema IS the schema, so the reply is
// valid JSON by construction. No "reply with ONLY JSON" prayers, no code-fence
// stripping, no prose to trim.
//
// Pure and shared: api/ai.ts (the edge proxy) builds the upstream payload and
// reads the reply through these helpers, and the client sends the schema
// through AIService. Keeping the logic here means it is testable in vitest,
// which an edge function is not.
//
// Design constraints:
//   - The tool name is fixed. The schema is the only thing callers control,
//     so the proxy's attack surface does not grow: a schema is data, never
//     code, and Anthropic validates it again upstream.
//   - Existing parsers stay. The proxy returns the tool input STRINGIFIED in
//     the same { text } envelope as before, so parseCapture / parseTriage keep
//     working unchanged, still enforcing their own invariants (noDashes,
//     bucket coercion). Structure guaranteed at the source, tolerance kept at
//     the edge: belt and suspenders, on purpose.

export const EMIT_TOOL_NAME = "emit";

// A schema must be a plain JSON object declaring an object type, and small.
// 8KB is far above any schema this app sends and far below anything that
// could bloat the input-size budget the proxy already enforces.
export const MAX_SCHEMA_BYTES = 8192;

export function schemaOk(schema: unknown): schema is Record<string, unknown> {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return false;
  if ((schema as { type?: unknown }).type !== "object") return false;
  try {
    return JSON.stringify(schema).length <= MAX_SCHEMA_BYTES;
  } catch {
    return false;
  }
}

// The fields to spread into the upstream Anthropic request body.
export function toolPayload(schema: Record<string, unknown>): {
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  tool_choice: { type: "tool"; name: string };
} {
  return {
    tools: [{
      name: EMIT_TOOL_NAME,
      description: "Return the result in exactly the required shape.",
      input_schema: schema,
    }],
    tool_choice: { type: "tool", name: EMIT_TOOL_NAME },
  };
}

interface ContentBlock { type: string; text?: string; name?: string; input?: unknown }

// Reads the reply. A forced tool call answers with a tool_use block whose
// input is the structured result: stringify it into the { text } envelope.
// Any other shape falls back to joined text blocks, so a non-schema call (or
// an upstream surprise) degrades to exactly the old behavior.
export function extractText(content: ContentBlock[] | undefined): string {
  const blocks = content ?? [];
  const tool = blocks.find((b) => b.type === "tool_use" && b.name === EMIT_TOOL_NAME);
  if (tool && tool.input !== undefined) {
    try {
      return JSON.stringify(tool.input);
    } catch {
      /* fall through to text blocks */
    }
  }
  return blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}
