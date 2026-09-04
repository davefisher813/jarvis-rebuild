import type { Bucket, TriageMap } from "./triage";
import type { ThreadRow } from "../connections/google/map";

// Sender overrides (email 2): when the user files a sender somewhere, that is
// a RULE, not a training hint. Deterministic, instant, permanent, the model
// never gets a second chance to misfile that sender. Overrides win over AI
// triage, always.

export const KEY = "jarvis.mail.rules.v1";
const CAP = 200;

export type SenderRules = Record<string, Bucket>; // sender email (lowercased) -> bucket

export function loadRules(storage: Pick<Storage, "getItem"> = localStorage): SenderRules {
  try {
    const raw = storage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: SenderRules = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (v === "needs_you" || v === "worth_knowing" || v === "noise") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRule(
  senderEmail: string,
  bucket: Bucket,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): SenderRules {
  const rules = loadRules(storage);
  rules[senderEmail.trim().toLowerCase()] = bucket;
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

// Overrides beat the model. The gist survives (it is still true), only the
// bucket moves.
export function applyRules(map: TriageMap, rows: ThreadRow[], rules: SenderRules): TriageMap {
  const out: TriageMap = { ...map };
  for (const r of rows) {
    const forced = rules[r.fromEmail.toLowerCase()];
    if (forced && out[r.id] && out[r.id]!.bucket !== forced) {
      out[r.id] = { ...out[r.id]!, bucket: forced };
    }
  }
  return out;
}

// Undo a standing rule. A permanent decision with no way back is not a
// feature, and the sender returns to whatever the AI thinks of them next pass.
export function clearRule(senderEmail: string): SenderRules {
  const key = senderEmail.trim().toLowerCase();
  const all = loadRules();
  if (!(key in all)) return all;
  const next = { ...all };
  delete next[key];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
