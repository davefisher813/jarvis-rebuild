import { AUTOMATED_ADDRESS } from "./noReply";

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

// EMAIL-F-16 (2026-09-05): the switch itself, which used to be a private
// const inside MessagesFlow. It lives here now because the thing that acts on
// it (autoReplyPump.ts, mounted in AppShell) is not the tab that owns the
// toggle: a courtesy that only runs while he is looking at Email is not a
// courtesy. Per device, on purpose: this is the one thing in the app that
// sends without a tap.
const ON_KEY = "jarvis.mail.autoreply.on.v1";

export function autoReplyEnabled(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try { return storage.getItem(ON_KEY) === "on"; } catch { return false; }
}

export function setAutoReplyEnabled(on: boolean, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(ON_KEY, on ? "on" : "off"); } catch { /* private mode */ }
}
// One copy of this rule, in noReply.ts. It lived here AND in autoReply.ts,
// and the thread screen (the one place a person presses Reply) consulted
// neither, which is how reply chips ended up on a no-reply sender.
const AUTOMATED = AUTOMATED_ADDRESS;

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
  // UP-MIND-18 (2026-09-05): how sure the app is about what this thread IS.
  // A reply that goes out with nobody looking may only go out on a claim
  // that can show the sentence behind it. Defaults to high so every existing
  // caller and test keeps its behaviour; the callers that know pass it.
  confidence?: "high" | "low";
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
  // The gate order the decision names: confidence first, then everything
  // else. A low-confidence read never sends on its own, at any AI level.
  if (i.confidence === "low") return false;
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

// EMAIL-F-29 (2026-09-05): AUTO_REPLY_SUBJECT_PREFIX and AUTO_REPLY_SYSTEM
// had no caller. The pump replies on the thread, so Gmail supplies the "Re:",
// and autoReplyBody is deterministic text that never reaches a model.

// Shown wherever the setting lives, so the promise and the guard are the
// same sentence.
export const AUTO_REPLY_EXPLAINER =
  "Only your VIPs, once each, and only while a focus block is running. It names the time you'll be back.";
