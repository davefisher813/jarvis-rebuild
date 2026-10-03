// CATEGORY PREFERENCE SUGGESTIONS (IMPLEMENTATION-SPEC.md 00.1, "Standing
// grants learned from taps"). Three manual taps filing the same sender in
// one account under the same category within 30 days earn one question:
// "Use this category next time?" with Remember and Not now. Remember creates
// an exact local rule; Not now creates nothing. A rule only TAGS: it never
// hides, archives, files or touches the provider. Nothing here infers a
// send, a read or a life write, and nothing here runs on its own.
//
// Taps and rules live on the device under versioned keys (the stored-shapes
// law). The suggestion row itself is policy_suggestion on the server, so the
// Activity feed can show what was offered and what was answered.

export const TAPS_KEY = "jarvis.mail.categoryTaps.v1";
export const RULES_KEY = "jarvis.mail.categoryRules.v1";
export const TAP_WINDOW_DAYS = 30;
export const TAP_THRESHOLD = 3;
const TAP_CAP = 500;

export interface CategoryTap {
  id: string;
  /** ISO instant. */
  at: string;
  accountId: string;
  /** The exact sender address, lowercased. */
  senderExact: string;
  categoryId: string;
}

export interface CategoryRuleShape { sender_exact: string; account_id: string; category_id: string }

export interface CategoryRule extends CategoryRuleShape {
  /** ISO instant of the Remember tap. */
  acceptedAt: string;
  /** The policy_suggestion row it came from. */
  suggestionId: string | null;
}

export interface SuggestionDue {
  rule: CategoryRuleShape;
  evidence_tap_ids: string[];
}

export const ruleKey = (r: CategoryRuleShape): string => `${r.account_id}␟${r.sender_exact}␟${r.category_id}`;

export function normalizeSender(address: string): string {
  return address.trim().toLowerCase();
}

/** The taps with a new one appended, newest kept, capped. */
export function recordTap(taps: readonly CategoryTap[], tap: CategoryTap): CategoryTap[] {
  const next = [...taps.filter((t) => t.id !== tap.id), { ...tap, senderExact: normalizeSender(tap.senderExact) }];
  next.sort((a, b) => a.at.localeCompare(b.at));
  return next.length > TAP_CAP ? next.slice(next.length - TAP_CAP) : next;
}

/** A decision already taken on this exact rule: Remember (a rule exists) or Not now (dismissed at a tap count). */
export interface RuleDecisions { dismissed: Record<string, { atTapCount: number }> }

/**
 * Whether this tap is the third matching one in the window, with no rule
 * already covering it and no dismissal still standing. Three NEW taps after a
 * Not now earn the question again; a Remember ends the questions.
 */
export function suggestionDue(
  taps: readonly CategoryTap[], tap: CategoryTap, rules: readonly CategoryRule[], decisions: RuleDecisions, now: string,
): SuggestionDue | null {
  const rule: CategoryRuleShape = { sender_exact: normalizeSender(tap.senderExact), account_id: tap.accountId, category_id: tap.categoryId };
  const key = ruleKey(rule);
  if (rules.some((r) => ruleKey(r) === key)) return null;
  const since = Date.parse(now) - TAP_WINDOW_DAYS * 86400e3;
  const matching = taps.filter((t) =>
    t.accountId === rule.account_id && normalizeSender(t.senderExact) === rule.sender_exact && t.categoryId === rule.category_id && Date.parse(t.at) >= since,
  );
  const dismissedAt = decisions.dismissed[key]?.atTapCount ?? 0;
  const fresh = matching.length - dismissedAt;
  if (fresh < TAP_THRESHOLD) return null;
  return { rule, evidence_tap_ids: matching.slice(-TAP_THRESHOLD).map((t) => t.id) };
}

/** Remember: the exact rule, and nothing wider. */
export function rememberRule(rules: readonly CategoryRule[], shape: CategoryRuleShape, suggestionId: string | null, now: string): CategoryRule[] {
  const key = ruleKey(shape);
  return [...rules.filter((r) => ruleKey(r) !== key), { ...shape, acceptedAt: now, suggestionId }];
}

/** Not now: remember only that the question was declined at this count, so three new taps may ask again. */
export function declineRule(decisions: RuleDecisions, taps: readonly CategoryTap[], shape: CategoryRuleShape, now: string): RuleDecisions {
  const since = Date.parse(now) - TAP_WINDOW_DAYS * 86400e3;
  const count = taps.filter((t) => t.accountId === shape.account_id && normalizeSender(t.senderExact) === shape.sender_exact && t.categoryId === shape.category_id && Date.parse(t.at) >= since).length;
  return { dismissed: { ...decisions.dismissed, [ruleKey(shape)]: { atTapCount: count } } };
}

export function forgetRule(rules: readonly CategoryRule[], shape: CategoryRuleShape): CategoryRule[] {
  const key = ruleKey(shape);
  return rules.filter((r) => ruleKey(r) !== key);
}

/** The one thing a rule does: name a category for a message. Null means no rule, and no guess. */
export function categoryFor(rules: readonly CategoryRule[], message: { accountId: string; fromAddress: string }): string | null {
  const sender = normalizeSender(message.fromAddress);
  return rules.find((r) => r.account_id === message.accountId && r.sender_exact === sender)?.category_id ?? null;
}

/** The receipt line for a rule pass over loaded rows: tagged locally, every row still in All. */
export function groupedLine(n: number): string {
  return `Grouped ${n} ${n === 1 ? "Update" : "Updates"} by Category`;
}

// ---- device storage: versioned keys, a corrupt value is an empty store ----

type Store = Pick<Storage, "getItem" | "setItem">;

export function loadTaps(storage: Store): CategoryTap[] {
  try {
    const raw = JSON.parse(storage.getItem(TAPS_KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((t): t is CategoryTap => !!t && typeof t === "object" && typeof (t as CategoryTap).id === "string" && typeof (t as CategoryTap).at === "string") : [];
  } catch { return []; }
}
export function saveTaps(storage: Store, taps: readonly CategoryTap[]): void {
  try { storage.setItem(TAPS_KEY, JSON.stringify(taps)); } catch { /* private mode */ }
}

export interface RulesStore { rules: CategoryRule[]; decisions: RuleDecisions }

export function loadRules(storage: Store): RulesStore {
  try {
    const raw = JSON.parse(storage.getItem(RULES_KEY) || "{}") as Partial<RulesStore> | null;
    return {
      rules: Array.isArray(raw?.rules) ? raw.rules.filter((r) => r && typeof r.sender_exact === "string") : [],
      decisions: { dismissed: raw?.decisions?.dismissed && typeof raw.decisions.dismissed === "object" ? raw.decisions.dismissed : {} },
    };
  } catch { return { rules: [], decisions: { dismissed: {} } }; }
}
export function saveRules(storage: Store, store: RulesStore): void {
  try { storage.setItem(RULES_KEY, JSON.stringify(store)); } catch { /* private mode */ }
}
