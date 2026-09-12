import type { Bucket, TriageMap } from "./triage";

// THIS THREAD, NOT THIS SENDER (E-16, Email Build Master, Dave's picks
// 2026-09-12). The sender chips on a thread ("This sender goes to") write a
// RULE: deterministic, permanent, every thread that sender ever sends. That
// is the right tool for a newsletter and the wrong one for a person who
// usually matters and just sent one thing that does not, or the reverse.
// Not for Me and Needs Me correct ONE thread. The sender's other mail is
// untouched, no SenderRules entry is written (laws/email.test.ts pins
// that), and the sender chips stay the only way to set a standing rule.
//
// Same shape and the same cap as rules.ts, keyed by thread id instead of
// sender. Local to this device, like the rules; nothing is written to Gmail.

export const KEY = "jarvis.mail.threadOverride.v1";
const CAP = 200;

export type ThreadOverrides = Record<string, Bucket>; // thread id -> bucket

export function loadOverrides(storage: Pick<Storage, "getItem"> = localStorage): ThreadOverrides {
  try {
    const raw = storage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: ThreadOverrides = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (v === "needs_you" || v === "worth_knowing" || v === "noise") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function save(map: ThreadOverrides, storage: Pick<Storage, "setItem">): ThreadOverrides {
  // Insertion order survives JSON, so trimming the front drops the oldest.
  const keys = Object.keys(map);
  const keep = keys.length > CAP ? keys.slice(keys.length - CAP) : keys;
  const out: ThreadOverrides = {};
  for (const k of keep) out[k] = map[k]!;
  try { storage.setItem(KEY, JSON.stringify(out)); } catch { /* private mode */ }
  return out;
}

export function saveOverride(threadId: string, bucket: Bucket, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): ThreadOverrides {
  const all = loadOverrides(storage);
  // Re-inserted at the end so a fresh correction is the last to be trimmed.
  delete all[threadId];
  all[threadId] = bucket;
  return save(all, storage);
}

export function clearOverride(threadId: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): ThreadOverrides {
  const all = loadOverrides(storage);
  if (!(threadId in all)) return all;
  delete all[threadId];
  return save(all, storage);
}

// A thread's own correction beats the sender rule for that thread, and only
// that thread: applied after applyRules, before the VIP pass, which is the
// one rule allowed to overrule everything (N4). The gist survives; only the
// bucket moves.
export function applyOverrides(map: TriageMap, overrides: ThreadOverrides): TriageMap {
  const out: TriageMap = { ...map };
  for (const [id, forced] of Object.entries(overrides)) {
    if (out[id] && out[id]!.bucket !== forced) out[id] = { ...out[id]!, bucket: forced };
  }
  return out;
}
