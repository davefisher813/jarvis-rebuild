import { JARVIS_VOICE, STYLE_SCOPE_RULE } from "../ai/voice";
import { noDashes } from "../ai/suggestions";

// DRAFTING ON THE CARD (U1 and U3, Dave 2026-08-20).
//
// The home page can already tell him which email needs an answer and who has
// been ignoring him. Both then sent him somewhere else to actually do it.
// Replying is the hard part, not knowing.
//
// This is the prompt pair and the parser for a reply (U1) and a nudge (U3)
// drafted for the CARD: short enough to read at a glance, in his voice, and
// never sent without a tap.
//
// Laws:
//   - A card draft is a PROPOSAL. Nothing sends on its own, ever.
//   - It fits the card. A four-paragraph reply that has to be scrolled inside
//     a home-page row is not an improvement on opening the thread.
//   - An unusable model reply means NO draft and a link to the thread, never
//     a fabricated one over his name.
//   - The nudge never mentions tracking, opens, or how long it has been in a
//     way that shames the other person. He wants the answer, not the argument.

export const CARD_REPLY_SYSTEM = [
  JARVIS_VOICE,
  STYLE_SCOPE_RULE,
  "You draft a SHORT reply the user can send as-is from a phone.",
  "One to three sentences. Answer the actual question. No greeting block, no signature.",
  "If the email asks for a decision the user has not made, write the reply that BUYS TIME honestly, naming when they will answer.",
  "Reply with ONLY the message body.",
].join("\n");

export const CARD_NUDGE_SYSTEM = [
  JARVIS_VOICE,
  STYLE_SCOPE_RULE,
  "You draft a SHORT follow-up for a message the user sent that got no reply.",
  "One or two sentences. Warm, zero guilt, zero passive aggression: assume they are busy and make replying easy.",
  "Never mention tracking, read receipts, or how many times they have been asked.",
  "Reply with ONLY the message body.",
].join("\n");

export function cardReplyPrompt(from: string, subject: string, gist: string, body: string, voice = ""): { system: string; user: string } {
  return {
    system: voice.trim() ? CARD_REPLY_SYSTEM + "\n\nWrite it as this person would write it:\n" + voice.trim() : CARD_REPLY_SYSTEM,
    user: `From: ${from}\nSubject: ${subject}\nWhat it wants: ${gist}\n\n${body.slice(0, 1500)}`,
  };
}

export function cardNudgePrompt(to: string, subject: string, days: number, voice = ""): { system: string; user: string } {
  return {
    system: voice.trim() ? CARD_NUDGE_SYSTEM + "\n\nWrite it as this person would write it:\n" + voice.trim() : CARD_NUDGE_SYSTEM,
    user: `The message went to ${to}, subject "${subject}", ${days} days ago. Draft the follow-up.`,
  };
}

// Longer than this and it does not belong on a card. The thread is one tap
// away and is the right place for a real letter.
export const CARD_DRAFT_MAX = 320;

// Tolerant of the wrappers models add, never inventive. Empty means no draft,
// which the UI shows as "open the thread", not as a blank message to send.
export function parseCardDraft(raw: string): string {
  let t = (raw || "").trim();
  if (!t) return "";
  // Strip a leading label ("Reply:", "Draft:") and any surrounding fence.
  t = t.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  t = t.replace(/^(reply|draft|response|nudge|follow[- ]?up)\s*:\s*/i, "").trim();
  // Models love wrapping a one-liner in quotes. The quotes are not his words.
  if (/^["'].*["']$/s.test(t)) t = t.slice(1, -1).trim();
  // A refusal or a question back to us is not a draft.
  if (/^(i (cannot|can't|am unable)|sorry,|as an ai)/i.test(t)) return "";
  t = noDashes(t);
  if (t.length > CARD_DRAFT_MAX) return "";
  return t;
}
