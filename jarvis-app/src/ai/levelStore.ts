// Session-wide holder for the user's AI Control state, framework-free like
// the toast singleton. The profile is the stored truth (ProfileData.ai);
// whoever loads or saves the profile mirrors it here so AIService and the
// pre-generation layer can consult it without hook plumbing. Applies
// instantly: setting it takes effect on the very next call.

import { AI_PIN_KEYS, DEFAULT_AI_LEVEL, type AIControlState, type AIPinKey } from "./aiGate";

let current: AIControlState = { level: DEFAULT_AI_LEVEL };
const subs = new Set<(s: AIControlState) => void>();

export function setAIControl(next: AIControlState | undefined): void {
  current = next ?? { level: DEFAULT_AI_LEVEL };
  for (const fn of subs) fn(getAIControl());
}

// THE ADMIN SWITCH (Dave 2026-09-30). When the admin has turned AI off for this
// account the session reads Off everywhere, pins included, WITHOUT touching the
// stored profile: the user's own choice is kept and comes straight back when the
// admin turns AI on again. Every reader already goes through getAIControl, so
// this one place is the whole client side; the proxy is the authority and
// refuses regardless.
let adminBlocked = false;
const OFF_EVERYWHERE: AIControlState = {
  level: "off",
  pins: Object.fromEntries(AI_PIN_KEYS.map((k) => [k, "off"])) as Partial<Record<AIPinKey, "off">>,
};

const blockSubs = new Set<() => void>();

export function setAdminAiBlocked(blocked: boolean): void {
  if (adminBlocked === blocked) return;
  adminBlocked = blocked;
  for (const fn of subs) fn(getAIControl());
  for (const fn of blockSubs) fn();
}

/** For a screen that has to say WHY AI is off (useSyncExternalStore shape). */
export function subscribeAdminAiBlock(fn: () => void): () => void {
  blockSubs.add(fn);
  return () => { blockSubs.delete(fn); };
}

export function isAdminAiBlocked(): boolean {
  return adminBlocked;
}

export function getAIControl(): AIControlState {
  return adminBlocked ? OFF_EVERYWHERE : current;
}

// PLUMB-F-19 (2026-09-05): subscribeAIControl had no subscriber and no test.
// Every reader calls getAIControl at the moment it is about to spend a token,
// which is when the level has to be right; a stale subscription would be the
// one way to spend at a level the person has since turned down.
