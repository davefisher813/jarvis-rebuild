import { describe, it, expect, vi } from "vitest";
import { citedRefs, runToolTurn, type TurnDeps } from "./turn";
import { MAX_CALLS_PER_TURN, MAX_STEPS, type Outcome, type ToolContext, type ToolImpl } from "./dispatcher";
import { WRAP_UP } from "./toolPrompt";
import type { AIBlock, AIMessage, AITurn } from "../../ai/AIService";
import type { ToolCall } from "./wire";

// ONE TURN OF THE CHAT WITH TOOLS (chat box order, 2026-10-24): the model is asked, the dispatcher runs what it asks for, the results go
// back, and a ceiling in code ends it. Scripted model, real dispatcher.

const NOW = new Date("2026-10-26T15:00:00Z");
const ctx = (): ToolContext => ({ seen: new Set(), now: NOW });
const c = (n: number, name = "search_items", input: Record<string, unknown> = { query: "plumber" }): ToolCall => ({ id: `toolu_${String(n).padStart(8, "0")}`, name: name as ToolCall["name"], input });
const say = (text: string): AITurn => ({ text, toolCalls: [], stop: "end_turn" });
const ask = (calls: ToolCall[], text = ""): AITurn => ({ text, toolCalls: calls, stop: "tool_use" });
const HISTORY: AIMessage[] = [{ role: "user", content: "Is the plumber booked?" }];

const search: ToolImpl = async () => ({ data: { items: [{ ref: "task:t1", title: "Call the plumber" }] }, refs: [{ kind: "task", id: "t1", label: "Call the plumber" }] });

function script(turns: AITurn[]) {
  const seen: AIMessage[][] = [];
  let i = 0;
  const step = vi.fn(async (messages: AIMessage[]) => { seen.push(structuredClone(messages)); return turns[Math.min(i++, turns.length - 1)]!; });
  return { step, seen };
}
function deps(step: TurnDeps["step"], over: Partial<TurnDeps> = {}): TurnDeps {
  return { step, dispatch: { impls: { search_items: search }, ctx: ctx() }, ...over };
}
const blocks = (m: AIMessage): AIBlock[] => (typeof m.content === "string" ? [] : m.content);

describe("runToolTurn", () => {
  it("an answer with no lookups is one step, and nothing is dispatched", async () => {
    const { step } = script([say("Yes, Friday at nine.")]);
    const r = await runToolTurn(HISTORY, deps(step));
    expect(r).toMatchObject({ text: "Yes, Friday at nine.", steps: 1, ended: "answered", outcomes: [] });
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("carries a lookup round: the model's own calls go back as it asked, with the dispatcher's results beside them", async () => {
    const { step, seen } = script([ask([c(1)], "Let me check."), say("Call the plumber is open.")]);
    const r = await runToolTurn(HISTORY, deps(step));
    expect(r).toMatchObject({ text: "Call the plumber is open.", steps: 2, ended: "answered" });
    expect(r.outcomes).toHaveLength(1);
    expect(r.outcomes[0]).toMatchObject({ state: "ran", call: { name: "search_items" } });

    const second = seen[1]!;
    expect(second[0]).toEqual(HISTORY[0]);
    expect(second[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me check." },
        { type: "tool_use", id: "toolu_00000001", name: "search_items", input: { query: "plumber" } },
      ],
    });
    const results = blocks(second[2]!);
    expect(second[2]!.role).toBe("user");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_00000001" });
    expect((results[0] as { content: string }).content).toContain("Call the plumber");
    expect(results[0]).not.toHaveProperty("is_error");
  });

  it("sends no empty text block when the model said nothing before its calls (the provider refuses one)", async () => {
    const { step, seen } = script([ask([c(1)]), say("ok")]);
    await runToolTurn(HISTORY, deps(step));
    const assistant = blocks(seen[1]![1]!);
    expect(assistant.map((b) => b.type)).toEqual(["tool_use"]);
  });

  it("answers each call of a step, in order, in one message", async () => {
    const { step, seen } = script([ask([c(1), c(2, "search_items", { query: "taxes" })]), say("done")]);
    await runToolTurn(HISTORY, deps(step));
    const results = blocks(seen[1]![2]!) as { tool_use_id: string }[];
    expect(results.map((b) => b.tool_use_id)).toEqual(["toolu_00000001", "toolu_00000002"]);
  });

  it("a refusal goes back as an error result and the turn carries on", async () => {
    const { step, seen } = script([ask([c(1, "run_query", {})]), say("I could not run that.")]);
    const r = await runToolTurn(HISTORY, deps(step));
    expect(r.outcomes[0]).toMatchObject({ state: "refused", code: "unknown_tool" });
    expect(blocks(seen[1]![2]!)[0]).toMatchObject({ type: "tool_result", is_error: true });
    expect(r.ended).toBe("answered");
  });

  it("says what is being looked at while each call runs, and nothing when the turn is over", async () => {
    const lines: (string | null)[] = [];
    const { step } = script([ask([c(1), c(2, "get_schedule", { from: "2026-10-26", to: "2026-10-26" })]), say("done")]);
    await runToolTurn(HISTORY, deps(step, { working: (l) => lines.push(l), dispatch: { impls: { search_items: search, get_schedule: async () => ({ data: {} }) }, ctx: ctx() } }));
    expect(lines).toEqual(["Searching your records", "Checking your schedule", null]);
  });

  it("clears the working line even when the model step fails", async () => {
    const lines: (string | null)[] = [];
    const step = vi.fn(async () => { throw new Error("boom"); });
    await expect(runToolTurn(HISTORY, deps(step, { working: (l) => lines.push(l) }))).rejects.toThrow("boom");
    expect(lines).toEqual([null]);
  });

  it("an empty finish is its own ending, not an answer", async () => {
    const { step } = script([say("   ")]);
    expect(await runToolTurn(HISTORY, deps(step))).toMatchObject({ text: "", ended: "empty" });
  });

  it("does not change the history it was given", async () => {
    const { step } = script([ask([c(1)]), say("ok")]);
    const h = structuredClone(HISTORY);
    await runToolTurn(h, deps(step));
    expect(h).toEqual(HISTORY);
  });
});

describe("the ceiling is in code", () => {
  it("a model that never stops asking is ended at MAX_STEPS, and the last step is never answered with results", async () => {
    const { step, seen } = script([ask([c(1)])]);
    const r = await runToolTurn(HISTORY, deps(step));
    expect(r.ended).toBe("cap");
    expect(step).toHaveBeenCalledTimes(MAX_STEPS);
    expect(r.steps).toBe(MAX_STEPS);
    // The dispatcher ran the calls of every step but the last: nothing it asked for on the last step is run.
    expect(r.outcomes).toHaveLength(MAX_STEPS - 1);
    expect(seen).toHaveLength(MAX_STEPS);
  });

  it("tells the model, with the last results, that no more lookups are coming", async () => {
    const { step, seen } = script([ask([c(1)])]);
    await runToolTurn(HISTORY, deps(step));
    const beforeLast = seen[MAX_STEPS - 1]!;
    const lastUser = blocks(beforeLast[beforeLast.length - 1]!);
    expect(lastUser[lastUser.length - 1]).toEqual({ type: "text", text: WRAP_UP });
    // And only then: the message before that carries results alone.
    const earlier = seen[MAX_STEPS - 2]!;
    expect(blocks(earlier[earlier.length - 1]!).some((b) => b.type === "text")).toBe(false);
  });

  it("caps the calls a whole turn may run, across steps: the rest come back refused", async () => {
    const four = [c(1), c(2), c(3), c(4)];
    const { step } = script([ask(four), ask(four.map((x, i) => c(10 + i))), ask(four.map((x, i) => c(20 + i))), say("done")]);
    const r = await runToolTurn(HISTORY, deps(step));
    const ran = r.outcomes.filter((o) => o.state === "ran");
    expect(ran).toHaveLength(MAX_CALLS_PER_TURN);
    expect(r.outcomes.filter((o) => o.code === "cap").length).toBeGreaterThan(0);
  });

  it("will not let a caller raise the ceiling", async () => {
    const { step } = script([ask([c(1)])]);
    await runToolTurn(HISTORY, deps(step, { maxSteps: 99 }));
    expect(step).toHaveBeenCalledTimes(MAX_STEPS);
  });

  it("a lower ceiling is honoured", async () => {
    const { step } = script([ask([c(1)])]);
    const r = await runToolTurn(HISTORY, deps(step, { maxSteps: 2 }));
    expect(step).toHaveBeenCalledTimes(2);
    expect(r.ended).toBe("cap");
  });
});

describe("citedRefs: sources are the records the answer names", () => {
  const o = (refs: { kind: string; id: string; label: string }[]): Outcome => ({ call: c(1), state: "ran", content: "{}", isError: false, refs });
  const refs = [
    { kind: "task", id: "t1", label: "Call the plumber" },
    { kind: "event", id: "e1", label: "Plumber visit" },
    { kind: "note", id: "n1", label: "House notes" },
  ];

  it("keeps a record whose title the answer uses, and drops one it merely came across", () => {
    expect(citedRefs("You have Call the plumber open, due Friday.", [o(refs)])).toEqual([refs[0]]);
  });

  it("matches without caring about case", () => {
    expect(citedRefs("see PLUMBER VISIT on Thursday", [o(refs)])).toEqual([refs[1]]);
  });

  it("names nothing when the answer names nothing", () => {
    expect(citedRefs("Nothing is booked.", [o(refs)])).toEqual([]);
  });

  it("lists each record once, across calls, and at most four", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ kind: "task", id: `t${i}`, label: `Task number ${i}` }));
    const text = many.map((m) => m.label).join(", ");
    expect(citedRefs(text, [o(many), o(many)])).toHaveLength(4);
    expect(citedRefs("Call the plumber", [o(refs), o(refs)])).toHaveLength(1);
  });

  it("recognises a title that was clipped with an ellipsis when it was returned", () => {
    expect(citedRefs("The long planning thing is due", [o([{ kind: "task", id: "t9", label: "The long planning thing…" }])])).toHaveLength(1);
  });
});
