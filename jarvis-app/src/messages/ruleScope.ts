import type { Bucket } from "./triage";

// STANDING RULES, v2 (E-24, Email Build Master 2026-09-12, Push E; EM9).
//
// A standing rule is still the one thing it has been since email 2: a
// sender filed somewhere, deterministic, instant, and it beats the model.
// Two things are layered on top of that core, and only two:
//
//   account   Which inbox the rule speaks for. Unset means every account,
//             which is what every rule made before this push meant.
//   enabled   Off stops the rule being consulted without losing the
//             sender -> bucket mapping, so "not right now" is not "forget
//             what I decided".
//
// Not a rewrite. The doc's fuller model (conditions, exceptions, a scope
// beyond the account) was the alternate option and Dave chose this one;
// laws/email.test.ts law 3 pins that this type never grows past these
// three fields.
//
// Migration: the store keeps its v1 key. A v1 entry is a bare bucket
// string; it reads as {bucket, enabled: true} with no account, and is
// written back in the v2 shape the next time any rule is saved. Nothing is
// lost and a device on the old build still finds the key it knows.

export interface SenderRule {
  bucket: Bucket;
  account?: string;
  enabled: boolean;
}

export type SenderRules = Record<string, SenderRule>; // sender email (lowercased) -> rule

const BUCKETS = new Set<string>(["needs_you", "worth_knowing", "noise"]);

/** One stored entry, v1 or v2, into the v2 shape. Null for junk. */
export function normalizeRule(v: unknown): SenderRule | null {
  if (typeof v === "string") return BUCKETS.has(v) ? { bucket: v as Bucket, enabled: true } : null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as { bucket?: unknown; account?: unknown; enabled?: unknown };
  if (typeof o.bucket !== "string" || !BUCKETS.has(o.bucket)) return null;
  return {
    bucket: o.bucket as Bucket,
    ...(typeof o.account === "string" && o.account ? { account: o.account.toLowerCase() } : {}),
    enabled: o.enabled !== false,
  };
}

/** A whole stored map (or a profile mirror from any build) into v2. */
export function migrateRules(p: unknown): SenderRules {
  if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
  const out: SenderRules = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    const r = normalizeRule(v);
    if (r) out[k] = r;
  }
  return out;
}

/** Whether this rule speaks for a thread in `account`. Off never applies;
 *  a rule with no account applies everywhere. */
export function ruleApplies(rule: SenderRule, account: string | undefined): boolean {
  if (!rule.enabled) return false;
  if (!rule.account) return true;
  return !!account && rule.account === account.toLowerCase();
}
