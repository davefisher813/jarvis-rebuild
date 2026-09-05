// The AI Control gate (addendum items 18-21). Pure and dependency-free
// because it is imported BOTH by the client (AIService refuses locally, so
// the UI can say why) and by the server proxy (api/ai.ts refuses
// authoritatively, so a client bug can never spend AI the user turned off).
// Same doctrine as adminCompute: one shared pure module, two importers.

export type AILevel = "everything" | "draft" | "request" | "off";

export const AI_LEVELS: readonly AILevel[] = ["everything", "draft", "request", "off"];

// Per-feature pins (addendum item 19). "match" follows the master level.
//
// PLUMB-F-13 (2026-09-05): this was a bare union, and the settings screen
// kept its own copy of the same five names. A pin the screen offered but no
// call site ever passed looked identical to a working one: the switch moved,
// nothing changed. One runtime list now, the type derived from it, and a law
// test (laws/aiControl.test.ts) that fails if a pin on this list is not
// enforced anywhere in the app.
export const AI_PIN_KEYS = ["emailDrafts", "morningPlan", "pasteFallback", "messageDrafts", "estimates"] as const;
export type AIPinKey = (typeof AI_PIN_KEYS)[number];

export interface AIControlState {
  level: AILevel;
  pins?: Partial<Record<AIPinKey, AILevel | "match">>;
}

// Draft Only is the default: AI drafts and suggests but takes no autonomous
// action. It is also where onboarding's Skip lands (item 22).
export const DEFAULT_AI_LEVEL: AILevel = "draft";

export function normalizeLevel(raw: unknown): AILevel {
  return AI_LEVELS.includes(raw as AILevel) ? (raw as AILevel) : DEFAULT_AI_LEVEL;
}

// The effective level for a feature: its pin unless the pin matches master.
export function effectiveLevel(ctrl: AIControlState | undefined, pin?: AIPinKey): AILevel {
  const master = normalizeLevel(ctrl?.level);
  if (!pin) return master;
  const pinned = ctrl?.pins?.[pin];
  if (!pinned || pinned === "match") return master;
  return normalizeLevel(pinned);
}

// May a proxy call happen at this level?
// - off: never. Off means zero AI calls; the deterministic core is untouched.
// - request: only calls the user just asked for. Background pre-generation
//   is refused, which is what makes On Request honest.
// - draft and everything: background drafting allowed. What separates them
//   (autonomous ACTIONS, pushes 15-17) is app behavior, not proxy traffic.
export function aiCallAllowed(level: AILevel, background: boolean): boolean {
  if (level === "off") return false;
  if (background) return level === "everything" || level === "draft";
  return true;
}

// The refusal message for each blocked case. Sentence case: the app talks.
export function refusalMessage(level: AILevel, background: boolean): string {
  if (level === "off") return "AI is turned off in Settings.";
  if (background) return "Background drafting is off at this AI level.";
  return "This call is not allowed at the current AI level.";
}
