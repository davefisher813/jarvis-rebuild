import type { TriageMap, Bucket } from "./triage";
import type { ThreadRow } from "../connections/google/map";
import { migrateRules, ruleApplies, type SenderRule, type SenderRules } from "./ruleScope";

// Sender overrides (email 2): when the user files a sender somewhere, that is
// a RULE, not a training hint. Deterministic, instant, permanent, the model
// never gets a second chance to misfile that sender. Overrides win over AI
// triage, always.
//
// E-24 (Push E, 2026-09-12): the shape is v2 (ruleScope.ts): each rule
// carries an optional account and an on/off switch on top of the bucket.
// The key is unchanged; v1 entries migrate on read.

export type { SenderRule, SenderRules } from "./ruleScope";

export const KEY = "jarvis.mail.rules.v1";
const CAP = 200;

export function loadRules(storage: Pick<Storage, "getItem"> = localStorage): SenderRules {
  try {
    const raw = storage.getItem(KEY);
    return migrateRules(raw ? (JSON.parse(raw) as unknown) : null);
  } catch {
    return {};
  }
}

function write(rules: SenderRules, storage: Pick<Storage, "setItem">): SenderRules {
  try {
    const keys = Object.keys(rules);
    const keep = keys.length > CAP ? keys.slice(keys.length - CAP) : keys;
    const out: SenderRules = {};
    for (const k of keep) out[k] = rules[k]!;
    storage.setItem(KEY, JSON.stringify(out));
    return out;
  } catch {
    return rules;
  }
}

/** File a sender. Filing again turns a switched-off rule back on (he just
 *  decided it again) and keeps whatever account it was scoped to. */
export function saveRule(
  senderEmail: string,
  bucket: Bucket,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): SenderRules {
  const rules = loadRules(storage);
  const key = senderEmail.trim().toLowerCase();
  const prev = rules[key];
  rules[key] = { bucket, enabled: true, ...(prev?.account ? { account: prev.account } : {}) };
  return write(rules, storage);
}

/** E-24: on or off. Off is not gone: the mapping stays for when it is on. */
export function setRuleEnabled(
  senderEmail: string,
  enabled: boolean,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): SenderRules {
  const rules = loadRules(storage);
  const key = senderEmail.trim().toLowerCase();
  const prev = rules[key];
  if (!prev || prev.enabled === enabled) return rules;
  rules[key] = { ...prev, enabled };
  return write(rules, storage);
}

/** E-24: which inbox the rule speaks for; undefined means all of them. */
export function setRuleAccount(
  senderEmail: string,
  account: string | undefined,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): SenderRules {
  const rules = loadRules(storage);
  const key = senderEmail.trim().toLowerCase();
  const prev = rules[key];
  if (!prev) return rules;
  const acct = account?.trim().toLowerCase() || undefined;
  if ((prev.account ?? undefined) === acct) return rules;
  const { account: _drop, ...rest } = prev;
  void _drop;
  rules[key] = { ...rest, ...(acct ? { account: acct } : {}) };
  return write(rules, storage);
}

// Overrides beat the model. The gist survives (it is still true), only the
// bucket moves. E-24: a rule that is off, or scoped to another account, is
// not consulted for this row.
export function applyRules(map: TriageMap, rows: ThreadRow[], rules: SenderRules): TriageMap {
  const out: TriageMap = { ...map };
  for (const r of rows) {
    const rule = rules[r.fromEmail.toLowerCase()];
    if (rule && ruleApplies(rule, r.account) && out[r.id] && out[r.id]!.bucket !== rule.bucket) {
      out[r.id] = { ...out[r.id]!, bucket: rule.bucket };
    }
  }
  return out;
}

// Undo a standing rule. A permanent decision with no way back is not a
// feature, and the sender returns to whatever the AI thinks of them next pass.
export function clearRule(senderEmail: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): SenderRules {
  const key = senderEmail.trim().toLowerCase();
  const all = loadRules(storage);
  if (!(key in all)) return all;
  const next = { ...all };
  delete next[key];
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
