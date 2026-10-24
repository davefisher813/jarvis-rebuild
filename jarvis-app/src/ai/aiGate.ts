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

// THE ADMIN SWITCH (Dave 2026-09-30, demo week). A second, separate gate that
// only the admin can move. It lives in the account's Supabase app_metadata
// (`ai_allowed`), which a signed-in user cannot write: that is the whole point,
// because everything in the profile above is the user's own to change. Absent
// means allowed, so every existing and every new account behaves as before;
// only an explicit `false` blocks. Pure and shared, like the level gate, so the
// proxy (authoritative) and the app (which only explains) read it one way.
export const ADMIN_AI_CODE = "AI_ADMIN_BLOCKED";
export const ADMIN_AI_MESSAGE = "AI is turned off for this account by the admin.";
export function adminAiAllowed(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== "object") return true;
  return (appMetadata as { ai_allowed?: unknown }).ai_allowed !== false;
}

// The refusal message for each blocked case. Sentence case: the app talks.
export function refusalMessage(level: AILevel, background: boolean): string {
  if (level === "off") return "AI is turned off in Settings.";
  if (background) return "Background drafting is off at this AI level.";
  return "This call is not allowed at the current AI level.";
}

// THE CODE EACH REFUSAL TRAVELS UNDER (Dave 2026-10-24, "the thread says what is actually wrong"). The sentence above was the only
// thing a refusal carried, so a caller that wanted to tell "you turned AI off" from "the provider is down" had to read English. The
// proxy now sends the code beside the sentence and the client throws it as a typed error; the sentences are unchanged.
export type RefusalCode = "AI_OFF" | "AI_BACKGROUND_OFF" | "AI_LEVEL";
export const REFUSAL_CODES: readonly RefusalCode[] = ["AI_OFF", "AI_BACKGROUND_OFF", "AI_LEVEL"];

export function refusalCode(level: AILevel, background: boolean): RefusalCode {
  if (level === "off") return "AI_OFF";
  if (background) return "AI_BACKGROUND_OFF";
  return "AI_LEVEL";
}

export function isRefusalCode(v: unknown): v is RefusalCode {
  return REFUSAL_CODES.includes(v as RefusalCode);
}

/** Every reason AI is unavailable BEFORE the provider is asked: the level, the admin switch, or a build with no backend. */
export type UnavailableCode = RefusalCode | typeof ADMIN_AI_CODE | "AI_NOT_CONFIGURED";

/** What the client throws when AI is not available at all (as opposed to the provider failing). The message is the same sentence as ever. */
export class AIUnavailableError extends Error {
  readonly code: UnavailableCode;
  constructor(code: UnavailableCode, message: string) {
    super(message);
    this.name = "AIUnavailableError";
    this.code = code;
  }
}

export function isUnavailableError(e: unknown): e is AIUnavailableError {
  return e instanceof AIUnavailableError;
}
