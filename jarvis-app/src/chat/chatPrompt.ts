// The chat AI prompt (addendum item 23). Prompt-heavy file: these sentences
// go to the model, not the screen, so it sits in the shortCopy exempt list
// with the other prompt files. Grounding rules live here: answer only from
// the user's real data, admit absence, never invent records.

import { JARVIS_VOICE } from "../ai/voice";
import type { AISystem } from "../ai/systemPrompt";

// UP-PLAT-02 (2026-09-06): two halves, not one string. The assembled context
// is identical to the one capture and suggestions send, so putting it first
// and on its own lets the proxy cache it once for all three (see
// ai/systemPrompt.ts). The words are the same words; only the order changed,
// and the instructions now sit closer to the question they are about.
export function chatSystemPrompt(contextText: string): AISystem {
  return {
    context: contextText,
    instructions: [
      JARVIS_VOICE,
      "Task: answer the user's question from their real data above, briefly.",
      "If the data does not contain the answer, say you don't have it. Never invent records, numbers, or dates.",
    ].join("\n"),
  };
}
