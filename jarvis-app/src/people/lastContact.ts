import type { GoogleApi } from "../connections/google/api";
import { mapThread } from "../connections/google/map";
import { JARVIS_VOICE } from "../ai/voice";

// Last contact (2026-08-10): when mail last moved between the user and this
// person, in either direction. This is what turns a "Family" page from a
// task list into a relationship surface: "last talked 3 weeks ago" is a fact
// the app already had access to and never used.
//
// Derived live from Gmail through the same client-side session the email
// deck uses (the token never leaves the device), one search per address,
// cached a day in localStorage, never persisted server-side. Same privacy
// stance and cache shape as voiceExamples.ts.

const CACHE_KEY = "jarvis.people.lastcontact.v1";
const CACHE_CAP = 200; // addresses
const TTL_MS = 24 * 3600e3;

type Cache = Record<string, { ms: number | null; ts: number }>;

function load(storage: Pick<Storage, "getItem">): Cache {
  try {
    const raw = storage.getItem(CACHE_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as Cache) : {};
  } catch {
    return {};
  }
}

function save(cache: Cache, storage: Pick<Storage, "setItem">): void {
  try {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_CAP) {
      const oldestFirst = keys.sort((a, b) => cache[a]!.ts - cache[b]!.ts);
      for (const k of oldestFirst.slice(0, keys.length - CACHE_CAP)) delete cache[k];
    }
    storage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* cache is an optimization, never a requirement */ }
}

// Latest message time (epoch ms) between the user and this address, or null
// when there is none / no email. A network failure returns the stale cached
// value rather than poisoning the cache with a false "never talked".
export async function lastContactFor(
  api: Pick<GoogleApi, "searchThreads">,
  email: string,
  now: number,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Promise<number | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const cache = load(storage);
  const hit = cache[e];
  if (hit && now - hit.ts < TTL_MS) return hit.ms;
  let ms: number | null = null;
  try {
    const metas = await api.searchThreads(`to:${e} OR from:${e}`, 1);
    const row = metas[0] ? mapThread(metas[0]) : null;
    ms = row?.dateMs ?? null;
  } catch {
    return hit?.ms ?? null;
  }
  cache[e] = { ms, ts: now };
  save(cache, storage);
  return ms;
}

// After this many silent days a person reads as "gone quiet". One number so
// every surface agrees on what quiet means.
export const QUIET_DAYS = 30;

export function isQuiet(lastMs: number | null, now: number): boolean {
  return lastMs !== null && now - lastMs > QUIET_DAYS * 86400000;
}

// The check-in draft for someone who has gone quiet (2026-08-10). Distinct
// from waiting.ts's nudgePrompt on purpose: that one chases a reply to a
// specific email; this one reopens a line that just went quiet, and it must
// never guilt anyone about the gap, including the user. The draft goes out
// over the user's name, so JARVIS_VOICE and the writing voice apply.
export function checkinPrompt(name: string, gapLabel: string, voice = ""): { system: string; user: string } {
  return {
    system: [
      JARVIS_VOICE,
      "You draft a SHORT, warm check-in message the user will send to someone they have not talked to in a while.",
      "One to three sentences. Zero guilt about the gap, from either side: no 'sorry it's been so long', no 'you never write'. Just warmth and an easy opening to reply to.",
      "Reply with ONLY the message body, no subject, no signature.",
      voice.trim() ? "\nWrite it as this person would write it:\n" + voice.trim() : "",
    ].filter(Boolean).join("\n"),
    user: `The message is to ${name}. They last talked ${gapLabel}. Draft the check-in.`,
  };
}

// "today" / "yesterday" / "6 Days ago" / "3 Weeks ago" / "2 Months ago".
// Sentence-ready lowercase; callers prefix "Last talked ".
export function agoLabel(ms: number, now: number): string {
  const days = Math.floor((now - ms) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} Days ago`;
  if (days < 61) return `${Math.floor(days / 7)} Weeks ago`;
  return `${Math.floor(days / 30)} Months ago`;
}
