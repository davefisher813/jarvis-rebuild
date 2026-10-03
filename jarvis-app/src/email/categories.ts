// CATEGORY CHIPS, LOCAL AND EXPLICIT (docs/jarvis-unified, slice 05;
// IMPLEMENTATION-SPEC.md 08 E04, 00.1 "Standing grants learned from taps").
// A category on a message is one of two things: the person's own tap (File
// Under, kept on this phone per message) or a rule they said Remember to,
// after three taps on the same sender in one account (policy/categoryTaps.ts
// counts, this file applies). A chip filters what is loaded and shows its
// count; All is every loaded message; nothing here hides, archives, files or
// touches the provider, and nothing guesses: no rule means no category.

import { ACCOUNT_PREFIX } from "../messages/mailCache";
import { mailAccountKey } from "../messages/mailIdentity";
import {
  categoryFor, declineRule, loadRules, loadTaps, recordTap, rememberRule, saveRules, saveTaps, suggestionDue,
  type CategoryRuleShape, type CategoryTap, type RulesStore, type SuggestionDue,
} from "../substrate/policy/categoryTaps";
import type { InboxRow } from "./emailClient";

type Store = Pick<Storage, "getItem" | "setItem">;

const tagsKey = (userId: string): string => ACCOUNT_PREFIX + mailAccountKey({ userId, account: "unified" }) + ":tags.v1";

/** The person's own taps, message id to category id, on this phone. */
export type Tags = Record<string, string>;

export function loadTags(userId: string, storage: Store = localStorage): Tags {
  try {
    const raw = JSON.parse(storage.getItem(tagsKey(userId)) || "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Tags = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
    return out;
  } catch { return {}; }
}

function saveTags(userId: string, tags: Tags, storage: Store): void {
  try { storage.setItem(tagsKey(userId), JSON.stringify(tags)); } catch { /* private mode */ }
}

/** The category a row shows under: the person's tap first, then a remembered rule, else none. */
export function categoryOf(row: Pick<InboxRow, "id" | "account_id" | "from_address">, tags: Tags, rules: RulesStore): string | null {
  return tags[row.id] ?? categoryFor(rules.rules, { accountId: row.account_id, fromAddress: row.from_address });
}

/** How many loaded rows sit under each category. All is the whole list and is counted by the caller. */
export function countsByCategory(rows: readonly InboxRow[], tags: Tags, rules: RulesStore): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const c = categoryOf(r, tags, rules);
    if (c) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

export interface Filed { tags: Tags; suggestion: SuggestionDue | null }

/**
 * File Under: the tag for this message, the tap on record, and, on the third
 * matching tap in thirty days with no rule and no standing Not Now, the one
 * question. The question is returned, never asked here.
 */
export function fileUnder(userId: string, row: Pick<InboxRow, "id" | "account_id" | "from_address">, categoryId: string, now: string, storage: Store = localStorage, tapId: string = `${row.id}:${now}`): Filed {
  const tags = { ...loadTags(userId, storage), [row.id]: categoryId };
  saveTags(userId, tags, storage);
  const tap: CategoryTap = { id: tapId, at: now, accountId: row.account_id, senderExact: row.from_address, categoryId };
  const taps = recordTap(loadTaps(storage), tap);
  saveTaps(storage, taps);
  const rules = loadRules(storage);
  return { tags, suggestion: suggestionDue(taps, tap, rules.rules, rules.decisions, now) };
}

/** Remember: the exact rule, kept on this phone. */
export function remember(shape: CategoryRuleShape, suggestionId: string | null, now: string, storage: Store = localStorage): RulesStore {
  const store = loadRules(storage);
  const next = { rules: rememberRule(store.rules, shape, suggestionId, now), decisions: store.decisions };
  saveRules(storage, next);
  return next;
}

/** Not Now: only that the question was declined at this count. */
export function notNow(shape: CategoryRuleShape, now: string, storage: Store = localStorage): RulesStore {
  const store = loadRules(storage);
  const next = { rules: store.rules, decisions: declineRule(store.decisions, loadTaps(storage), shape, now) };
  saveRules(storage, next);
  return next;
}

export { loadRules };
export type { RulesStore, SuggestionDue };
