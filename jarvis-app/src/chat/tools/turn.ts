// ONE TURN OF THE CHAT WITH TOOLS (chat box order, 2026-10-24). The model is asked; if it asks for tools the dispatcher runs them and the
// results go back; this repeats until the model answers in words or the turn's budget is spent. The loop is a plain `for` with a ceiling
// in code (MAX_STEPS model calls, MAX_CALLS_PER_TURN tool calls, byte caps on what comes back): nothing the model says can extend it.
//
// It carries the conversation, the proxy stays stateless: each step re-sends the messages so far, with the model's own tool_use blocks
// and the tool_results the dispatcher produced. Each step is its own request (its own request id, its own budget reservation), so the
// dollar cap meters a tool turn exactly as it meters any other calls.
//
// What the turn RETURNS is what happened, not what the model said happened: the outcomes are the dispatcher's own, and the thread draws
// receipts and provenance from them (law 3, "action claims render only from dispatcher states, never from the model's words").

import type { AIMessage, AIBlock, AITurn } from "../../ai/AIService";
import { TOOL_REGISTRY } from "./registry";
import { MAX_STEPS, dispatch, newBudget, type DispatchDeps, type Outcome, type RecordRef } from "./dispatcher";
import { WRAP_UP } from "./toolPrompt";

export interface TurnDeps {
  /** One model step: the messages so far in, the model's words and its calls out. ChatFlow binds the system prompt, the tool names and the gate. */
  step(messages: AIMessage[]): Promise<AITurn>;
  dispatch: Omit<DispatchDeps, "budget">;
  /** Told, in words, what is being looked at while a call runs ("Checking your schedule"); null when the turn is over. */
  working?(line: string | null): void;
  maxSteps?: number;
}

export interface TurnResult {
  text: string;
  /** Every call the dispatcher handled, in order. */
  outcomes: Outcome[];
  steps: number;
  /** answered: the model finished in words. cap: it kept asking until the budget was spent. empty: it finished with nothing to say. */
  ended: "answered" | "cap" | "empty";
}

export async function runToolTurn(history: AIMessage[], deps: TurnDeps): Promise<TurnResult> {
  const messages: AIMessage[] = [...history];
  const outcomes: Outcome[] = [];
  const budget = newBudget();
  const max = Math.max(1, Math.min(deps.maxSteps ?? MAX_STEPS, MAX_STEPS));
  try {
    for (let step = 1; step <= max; step++) {
      // A copy: the step's caller may keep what it was handed, and this array grows as the turn goes on.
      const turn = await deps.step([...messages]);
      const text = turn.text.trim();
      if (turn.toolCalls.length === 0) return { text, outcomes, steps: step, ended: text ? "answered" : "empty" };
      // The last step may not ask for more: nothing it asks for would be run, and the conversation it would need cannot be sent.
      if (step === max) return { text, outcomes, steps: step, ended: "cap" };

      // The model's own turn goes back exactly as it asked (a text block only when there is text: an empty one is refused upstream).
      const asked: AIBlock[] = [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...turn.toolCalls.map((c): AIBlock => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
      ];
      messages.push({ role: "assistant", content: asked });

      const results: AIBlock[] = [];
      for (const call of turn.toolCalls) {
        deps.working?.(TOOL_REGISTRY[call.name]?.working ?? null);
        const o = await dispatch(call, { ...deps.dispatch, budget });
        outcomes.push(o);
        results.push({ type: "tool_result", tool_use_id: call.id, content: o.content, ...(o.isError ? { is_error: true } : {}) });
      }
      // Before the last step the model is told, in the same message as the last results, that no more lookups are coming.
      messages.push({ role: "user", content: step + 1 === max ? [...results, { type: "text", text: WRAP_UP }] : results });
    }
    return { text: "", outcomes, steps: max, ended: "cap" };
  } finally {
    deps.working?.(null);
  }
}

/**
 * The records an answer was built from: those the turn's tools returned whose title the answer actually names, most relevant first, at
 * most `max`. A record that came back from a search but is not in the answer is not a source, so it earns no chip.
 */
export function citedRefs(text: string, outcomes: readonly Outcome[], max = 4): RecordRef[] {
  const said = text.toLowerCase();
  const out: RecordRef[] = [];
  const seen = new Set<string>();
  for (const o of outcomes) {
    for (const r of o.refs) {
      const key = `${r.kind}:${r.id}`;
      if (seen.has(key) || !r.label || !said.includes(r.label.toLowerCase().replace(/…$/, ""))) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= max) return out;
    }
  }
  return out;
}
