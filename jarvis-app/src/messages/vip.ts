import type { Bucket } from "./triage";
import { capAfterNumber } from "../shared/casing";

// YOUR THREE PEOPLE ALWAYS GET THROUGH (N4, Dave 2026-08-20).
//
// Sender rules already exist and are deterministic, which is right: when he
// files a sender somewhere, the model never gets a second chance to misfile
// them. A VIP is the same idea aimed the other way, and it is the one rule
// that has to survive an AI that is having an off day: mail from his
// attorney surfaces the moment it lands, whatever anything else thinks.
//
// Laws:
//   - VIP beats triage, beats rules, beats everything. That is the point.
//   - It is a short list on purpose. A VIP list with twenty people on it is
//     an inbox with extra steps, so the UI caps it and says why.
//   - It never hides anything. Being a VIP promotes mail; nothing is demoted
//     by someone else's promotion.

export const KEY = "jarvis.mail.vip.v1";
export const VIP_MAX = 5;

export function loadVips(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()).slice(0, VIP_MAX);
  } catch {
    return [];
  }
}

function save(list: string[], storage: Pick<Storage, "setItem">): void {
  try { storage.setItem(KEY, JSON.stringify(list.slice(0, VIP_MAX))); } catch { /* private mode */ }
}

export interface VipToggle {
  list: string[];
  /** true when this call tried to ADD a sixth and the cap refused it: the
   *  list is unchanged, not a removal, and the caller must not say it is. */
  capped: boolean;
}

// B3-7 (2026-09-04): this used to slice a would-be sixth entry off silently
// and return the original five unchanged, indistinguishable from a real
// toggle. The caller then checked isVip() on the result, found the new
// address still absent, and reported it as REMOVED ("X is back to normal")
// about someone who had never been a VIP. `capped` is what lets the caller
// tell the two cases apart and say the true one.
export function toggleVip(
  email: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): VipToggle {
  const e = email.trim().toLowerCase();
  if (!e) return { list: loadVips(storage), capped: false };
  const cur = loadVips(storage);
  if (cur.includes(e)) {
    const next = cur.filter((x) => x !== e);
    save(next, storage);
    return { list: next, capped: false };
  }
  if (cur.length >= VIP_MAX) return { list: cur, capped: true };
  const next = [...cur, e];
  save(next, storage);
  return { list: next, capped: false };
}

export function isVip(email: string | undefined, vips: string[]): boolean {
  return !!email && vips.includes(email.toLowerCase());
}

// VIP mail is needs_you, always. Applied AFTER triage and after sender rules,
// because it is the rule that is allowed to overrule both.
export function applyVips<T extends { id: string; fromEmail: string }>(
  map: Record<string, { bucket: Bucket; gist: string; by?: string; lastMsgId: string }>,
  rows: T[],
  vips: string[],
): typeof map {
  if (vips.length === 0) return map;
  const out = { ...map };
  for (const r of rows) {
    if (!isVip(r.fromEmail, vips)) continue;
    const cur = out[r.id];
    if (cur) out[r.id] = { ...cur, bucket: "needs_you" };
  }
  return out;
}

export function vipLine(n: number): string {
  if (n === 0) return "Nobody yet · Their mail always surfaces";
  return capAfterNumber(n === 1 ? "1 person always gets through" : `${n} people always get through`);
}
