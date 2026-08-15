// Session-wide holder for the user's AI Control state, framework-free like
// the toast singleton. The profile is the stored truth (ProfileData.ai);
// whoever loads or saves the profile mirrors it here so AIService and the
// pre-generation layer can consult it without hook plumbing. Applies
// instantly: setting it takes effect on the very next call.

import { DEFAULT_AI_LEVEL, type AIControlState } from "./aiGate";

let current: AIControlState = { level: DEFAULT_AI_LEVEL };
const subs = new Set<(s: AIControlState) => void>();

export function setAIControl(next: AIControlState | undefined): void {
  current = next ?? { level: DEFAULT_AI_LEVEL };
  for (const fn of subs) fn(current);
}

export function getAIControl(): AIControlState {
  return current;
}

export function subscribeAIControl(fn: (s: AIControlState) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
