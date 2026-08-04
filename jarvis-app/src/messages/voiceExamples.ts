import type { GoogleApi } from "../connections/google/api";
import { mapThreadFull } from "../connections/google/map";

// Voice examples (email 2): the user's own sent messages TO a given person are
// the ground truth of how they write to that person — better than any
// instruction. Fetched client-side through the same Gmail session (the token
// never leaves the phone), capped small, cached per sender so a deck run
// costs at most one search per NEW sender.
//
// Privacy stance: examples live in localStorage on the user's device only.
// They are sent to the AI proxy inside the drafting prompt (same path the
// email bodies already travel) and are never persisted server-side.

const CACHE_KEY = "jarvis.mail.voice.v1";
const CACHE_CAP = 40; // senders
const MAX_EXAMPLES = 3;
const MAX_CHARS = 500;

type VoiceCache = Record<string, { examples: string[]; ts: number }>;

function load(storage: Pick<Storage, "getItem">): VoiceCache {
  try {
    const raw = storage.getItem(CACHE_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return typeof p === "object" && p !== null && !Array.isArray(p) ? (p as VoiceCache) : {};
  } catch {
    return {};
  }
}

function save(cache: VoiceCache, storage: Pick<Storage, "setItem">): void {
  try {
    const keys = Object.keys(cache);
    if (keys.length > CACHE_CAP) {
      const oldestFirst = keys.sort((a, b) => cache[a]!.ts - cache[b]!.ts);
      for (const k of oldestFirst.slice(0, keys.length - CACHE_CAP)) delete cache[k];
    }
    storage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* cache is an optimization, never a requirement */ }
}

// Strip quoted history and signatures so an example is the user's words, not
// the whole thread they replied on top of.
export function cleanSentBody(body: string): string {
  const lines = body.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break; // quoted reply block
    if (/^On .+ wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*$/.test(line.trim())) break; // signature divider
    kept.push(line);
  }
  return kept.join("\n").trim().slice(0, MAX_CHARS);
}

// Fetch up to MAX_EXAMPLES of the user's own recent messages to this address.
// Failure returns [] — drafting still works, just without the examples.
export async function voiceExamplesFor(
  api: Pick<GoogleApi, "searchThreads" | "getThread">,
  senderEmail: string,
  now: number,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): Promise<string[]> {
  const email = senderEmail.trim().toLowerCase();
  if (!email) return [];
  const cache = load(storage);
  const hit = cache[email];
  if (hit && now - hit.ts < 7 * 24 * 3600e3) return hit.examples;

  let examples: string[] = [];
  try {
    const metas = await api.searchThreads("in:sent to:" + email, 3);
    for (const meta of metas) {
      if (examples.length >= MAX_EXAMPLES) break;
      const full = mapThreadFull(await api.getThread(meta.id));
      // The user's turns are the ones NOT from the sender.
      for (const m of full.messages) {
        if (m.fromEmail.toLowerCase() === email) continue;
        const cleaned = cleanSentBody(m.body);
        if (cleaned.length >= 10) {
          examples.push(cleaned);
          if (examples.length >= MAX_EXAMPLES) break;
        }
      }
    }
  } catch {
    examples = [];
  }
  cache[email] = { examples, ts: now };
  save(cache, storage);
  return examples;
}
