import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIService, type AIMessage } from "./AIService";
import { AIUnavailableError, isUnavailableError } from "./aiGate";
import { AIProviderError, isProviderError } from "./providerFailure";
import { clearBudgetBlock } from "./budgetBlock";
import { clearProviderBlock } from "./providerBlock";
import { setAIControl } from "./levelStore";

// ONE STEP OF A TOOL TURN, FROM THE APP'S SIDE (chat box order, 2026-10-24). The same gate, budget and failure words as complete(), with
// the names of the tools the model may ask for, and the calls it asked for handed back checked.

const MSG: AIMessage[] = [{ role: "user", content: "Is the plumber booked?" }];
let bodies: Record<string, unknown>[] = [];

function svc(responses: Response[]) {
  const fetchImpl = vi.fn(async (_u: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return responses.shift()!; });
  return { s: new AIService({ available: true, fetchImpl: fetchImpl as unknown as typeof fetch, getToken: () => "t" }), fetchImpl };
}
const reply = (o: object) => new Response(JSON.stringify(o), { status: 200 });

beforeEach(() => { bodies = []; clearBudgetBlock(); clearProviderBlock(); setAIControl({ level: "everything" }); });

describe("completeTurn", () => {
  it("names the tools it wants and nothing else about them", async () => {
    const { s } = svc([reply({ text: "ok", toolCalls: [], stop: "end_turn" })]);
    await s.completeTurn(MSG, "be brief", { tools: ["search_items", "get_schedule"], kind: "chat" });
    expect(bodies[0]!.tools).toEqual(["search_items", "get_schedule"]);
    expect(bodies[0]).not.toHaveProperty("schema");
    expect(bodies[0]!.kind).toBe("chat");
    expect(typeof bodies[0]!.requestId).toBe("string");
  });

  it("returns the words, the calls and why it stopped", async () => {
    const { s } = svc([reply({ text: "Looking.", toolCalls: [{ id: "toolu_01AAAAAA", name: "search_items", input: { query: "plumber" } }], stop: "tool_use" })]);
    expect(await s.completeTurn(MSG, undefined, { tools: ["search_items"] })).toEqual({
      text: "Looking.",
      toolCalls: [{ id: "toolu_01AAAAAA", name: "search_items", input: { query: "plumber" } }],
      stop: "tool_use",
    });
  });

  it("keeps only calls shaped as the proxy sends them", async () => {
    const { s } = svc([reply({
      text: "x",
      toolCalls: [
        { id: "toolu_01AAAAAA", name: "search_items", input: { query: "a" } },
        { id: 7, name: "search_items", input: {} },
        { id: "toolu_01BBBBBB", name: "search_items", input: "no" },
        { id: "toolu_01CCCCCC", name: "search_items", input: null },
        { id: "toolu_01DDDDDD", name: "search_items", input: [1] },
        null,
        "call",
      ],
    })]);
    const t = await s.completeTurn(MSG, undefined, { tools: ["search_items"] });
    expect(t.toolCalls.map((c) => c.id)).toEqual(["toolu_01AAAAAA"]);
    expect(t.stop).toBeNull();
  });

  it("an older proxy that sends only { text } is a turn with no calls", async () => {
    const { s } = svc([reply({ text: "Friday." })]);
    expect(await s.completeTurn(MSG, undefined, { tools: ["search_items"] })).toEqual({ text: "Friday.", toolCalls: [], stop: null });
  });

  it("carries the tool blocks of the turn so far on the wire, as given", async () => {
    const { s } = svc([reply({ text: "done" })]);
    const turn: AIMessage[] = [
      ...MSG,
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_01AAAAAA", name: "search_items", input: { query: "plumber" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01AAAAAA", content: "{}", is_error: true }] },
    ];
    await s.completeTurn(turn, undefined, { tools: ["search_items"] });
    expect(bodies[0]!.messages).toEqual(turn);
  });
});

describe("the same gate and the same failure words as every other call", () => {
  it("AI Off is refused before any request, with its code", async () => {
    setAIControl({ level: "off" });
    const { s, fetchImpl } = svc([]);
    const e = await s.completeTurn(MSG, undefined, { tools: ["search_items"] }).catch((x) => x);
    expect(isUnavailableError(e)).toBe(true);
    expect((e as AIUnavailableError).code).toBe("AI_OFF");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a provider failure arrives typed, in the proxy's plain words", async () => {
    const { s } = svc([new Response(JSON.stringify({ error: "The AI provider isn't answering right now · Try again in a moment", code: "AI_PROVIDER_BUSY", retryable: true }), { status: 502 })]);
    const e = await s.completeTurn(MSG, undefined, { tools: ["search_items"] }).catch((x) => x);
    expect(isProviderError(e)).toBe(true);
    expect((e as AIProviderError).retryable).toBe(true);
  });

  it("a refused menu is an ordinary failure, not a silent empty answer", async () => {
    const { s } = svc([new Response(JSON.stringify({ error: "Bad tools" }), { status: 400 })]);
    const e = (await s.completeTurn(MSG, undefined, { tools: ["search_items"] }).catch((x) => x)) as Error;
    expect(e.message).toMatch(/^AI request failed \(400\)/);
  });
});

describe("complete() is exactly what it was", () => {
  it("sends no tools and returns only the text", async () => {
    const { s } = svc([reply({ text: "plain", toolCalls: [{ id: "toolu_01AAAAAA", name: "search_items", input: {} }] })]);
    expect(await s.complete(MSG, "x", { kind: "chat" })).toBe("plain");
    expect(bodies[0]).not.toHaveProperty("tools");
  });
});
