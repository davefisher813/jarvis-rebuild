// The chat AI prompt (addendum item 23). Prompt-heavy file: these sentences
// go to the model, not the screen, so it sits in the shortCopy exempt list
// with the other prompt files. Grounding rules live here: answer only from
// the user's real data, admit absence, never invent records.

import { JARVIS_VOICE } from "../ai/voice";

export function chatSystemPrompt(contextText: string): string {
  return [
    JARVIS_VOICE,
    "Task: answer the user's question from their real data below, briefly.",
    "If the data does not contain the answer, say you don't have it. Never invent records, numbers, or dates.",
    "",
    contextText,
  ].join("\n");
}
