import { describe, it, expect, vi } from "vitest";
import { schemaOk, toolPayload, extractText, EMIT_TOOL_NAME, MAX_SCHEMA_BYTES } from "./structured";
import { CAPTURE_SCHEMA, parseCapture } from "./capture";
import { TRIAGE_SCHEMA, parseTriage } from "../messages/triage";
import { AIService } from "./AIService";

describe("schemaOk", () => {
  it("accepts a plain object schema of type object", () => {
    expect(schemaOk({ type: "object", properties: {} })).toBe(true);
    expect(schemaOk(CAPTURE_SCHEMA)).toBe(true);
    expect(schemaOk(TRIAGE_SCHEMA)).toBe(true);
  });

  it("rejects everything else", () => {
    expect(schemaOk(undefined)).toBe(false);
    expect(schemaOk(null)).toBe(false);
    expect(schemaOk("object")).toBe(false);
    expect(schemaOk([])).toBe(false);
    expect(schemaOk({ type: "array" })).toBe(false);
    expect(schemaOk({})).toBe(false);
  });

  it("rejects an oversized schema", () => {
    const big = { type: "object", description: "x".repeat(MAX_SCHEMA_BYTES) };
    expect(schemaOk(big)).toBe(false);
  });
});

describe("toolPayload", () => {
  it("forces the emit tool with the given schema", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    const p = toolPayload(schema);
    expect(p.tools).toHaveLength(1);
    expect(p.tools[0]!.name).toBe(EMIT_TOOL_NAME);
    expect(p.tools[0]!.input_schema).toBe(schema);
    expect(p.tool_choice).toEqual({ type: "tool", name: EMIT_TOOL_NAME });
  });
});

describe("extractText", () => {
  it("returns the forced tool input stringified", () => {
    const out = extractText([
      { type: "text", text: "I'll file that." },
      { type: "tool_use", name: EMIT_TOOL_NAME, input: { kind: "task", title: "Call Sam" } },
    ]);
    expect(JSON.parse(out)).toEqual({ kind: "task", title: "Call Sam" });
  });

  it("falls back to joined text blocks when no tool block exists", () => {
    expect(extractText([{ type: "text", text: "Hello " }, { type: "text", text: "there" }])).toBe("Hello there");
  });

  it("ignores tool blocks under other names", () => {
    expect(extractText([
      { type: "tool_use", name: "other", input: { nope: true } },
      { type: "text", text: "plain" },
    ])).toBe("plain");
  });

  it("is safe on an empty or missing reply", () => {
    expect(extractText(undefined)).toBe("");
    expect(extractText([])).toBe("");
  });
});

describe("schemas round-trip through the existing parsers", () => {
  it("a capture-shaped tool input parses through parseCapture", () => {
    const raw = extractText([
      { type: "tool_use", name: EMIT_TOOL_NAME, input: { kind: "event", title: "Dentist", date: "2026-08-22", start: "09:30" } },
    ]);
    const parsed = parseCapture(raw)!;
    expect(parsed.kind).toBe("event");
    expect(parsed.title).toBe("Dentist");
    expect(parsed.start).toBe("09:30");
  });

  it("a triage-shaped tool input parses through parseTriage, wrapper and all", () => {
    const rows = [
      { id: "t1", from: "a", subject: "s", snippet: "sn", lastMsgId: "m1" },
      { id: "t2", from: "b", subject: "s2", snippet: "sn2", lastMsgId: "m2" },
    ] as Parameters<typeof parseTriage>[1];
    const raw = extractText([{
      type: "tool_use",
      name: EMIT_TOOL_NAME,
      input: {
        threads: [
          { id: "t1", bucket: "needs_you", gist: "Alice wants the form by Friday", by: "Friday" },
          { id: "t2", bucket: "noise", gist: "A newsletter", by: "" },
        ],
      },
    }]);
    const map = parseTriage(raw, rows)!;
    expect(map.t1!.bucket).toBe("needs_you");
    expect(map.t1!.by).toBe("Friday");
    expect(map.t2!.bucket).toBe("noise");
    expect(map.t2!.by).toBeUndefined();
  });
});

describe("AIService forwards the schema", () => {
  it("puts schema in the request body only when given", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ text: "{}" }), { status: 200 }));
    const svc = new AIService({ available: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    await svc.complete([{ role: "user", content: "hi" }], undefined, { schema: CAPTURE_SCHEMA });
    await svc.complete([{ role: "user", content: "hi" }]);
    const first = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string) as { schema?: unknown };
    const second = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string) as { schema?: unknown };
    expect(first.schema).toEqual(CAPTURE_SCHEMA);
    expect(second.schema).toBeUndefined();
  });
});
