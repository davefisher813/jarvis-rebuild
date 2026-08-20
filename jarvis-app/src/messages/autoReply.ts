import { JARVIS_VOICE } from "../ai/voice";

// HEADS-DOWN AUTO-REPLY (N8, Dave 2026-08-20).
//
// This is the ONLY thing in the app that sends without a tap, so it carries
// the tightest guards in the app.
//
// Laws, all enforced here rather than in the UI:
//   - OFF by default. It is opt-in, per session, and turning focus off turns
//     this off with it.
//   - VIPs only. An auto-reply to a mailing list is a machine talking to a
//     machine over his name.
//   - ONCE per person per focus block. The second identical auto-reply is
//     what makes people hate autoresponders.
//   - It names a REAL time he will be back, taken from the focus block that
//     is actually running. A vague "later" is worse than silence.
//   - Never to a no-reply address, never to himself, never to a thread he
//     already answered inside this block.

const KEY = "jarvis.mail.autoreply.v1";
const AUTOMATED = /no-?reply|donotreply|notifications?@|mailer-daemon|@docs\.|@calendar-server\./i;

export interface AutoReplyState {
  blockId: string;              // the focus block currently running
  repliedTo: string[];          // lowercased emails already answered in it
}

export function loadAutoState(
  blockId: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): AutoReplyState {
  try {
    const p = JSON.parse(storage.getItem(KEY) || "null") as Partial<AutoReplyState> | null;
    if (!p || p.blockId !== blockId || !Array.isArray(p.repliedTo)) return { blockId, repliedTo: [] };
    return { blockId, repliedTo: p.repliedTo.filter((x): x is string => typeof x === "string") };
  } catch {
    return { blockId, repliedTo: [] };
  }
}

export function markAutoReplied(
  blockId: string,
  email: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): AutoReplyState {
  const cur = loadAutoState(blockId, storage);
  const next: AutoReplyState = { blockId, repliedTo: [...new Set([...cur.repliedTo, email.toLowerCase()])] };
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export interface AutoReplyInput {
  enabled: boolean;
  fromEmail: string;
  myEmail: string;
  vips: string[];
  state: AutoReplyState;
  alreadyRepliedThread: boolean;
}

// Every gate in one place, so "should this send" is a single answer with a
// single reason and never a chain of ifs spread across a component.
export function shouldAutoReply(i: AutoReplyInput): boolean {
  if (!i.enabled) return false;
  const from = (i.fromEmail || "").toLowerCase();
  if (!from) return false;
  if (from === (i.myEmail || "").toLowerCase()) return false;
  if (AUTOMATED.test(from)) return false;
  if (!i.vips.includes(from)) return false;
  if (i.state.repliedTo.includes(from)) return false;
  if (i.alreadyRepliedThread) return false;
  return true;
}

// The message. Deterministic on purpose: an auto-reply is the one place a
// model must not be improvising over his name while he is not looking.
export function autoReplyBody(backAt: string, name = ""): string {
  const who = name.trim() ? name.trim() + " is" : "I'm";
  return `${who} heads down until ${backAt}. I'll come back to you then.`;
}

export const AUTO_REPLY_SUBJECT_PREFIX = "Re: ";

// Shown wherever the setting lives, so the promise and the guard are the
// same sentence.
export const AUTO_REPLY_EXPLAINER =
  "Only your VIPs, once each, and only while a focus block is running. It names the time you'll be back.";

export const AUTO_REPLY_SYSTEM = JARVIS_VOICE;
