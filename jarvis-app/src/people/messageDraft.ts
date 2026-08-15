// Messages Drafting (addendum item 3): the prompt and link plumbing. The
// sheet itself stays service-free; these helpers are pure so the laws can
// pin them: the draft respects the person's register and flag, the sms link
// carries the text, and NOTHING is logged after the user leaves for the
// Messages app.

import { JARVIS_VOICE, STYLE_SCOPE_RULE } from "../ai/voice";
import type { PersonData } from "./types";

// The three-way tone control from the approved preview. It shapes THIS
// message; the person's stored register and flag still set the floor
// (flagged always wins, per the drafting stack's precedence).
export type DraftTone = "warm" | "direct" | "brief";
export const DRAFT_TONES: DraftTone[] = ["warm", "direct", "brief"];
export const TONE_LABEL: Record<DraftTone, string> = { warm: "Warm", direct: "Direct", brief: "Brief" };

const TONE_RULE: Record<DraftTone, string> = {
  warm: "Tone for this message: warm. A little more feeling than usual, still concise.",
  direct: "Tone for this message: direct. Say the thing plainly, no cushioning.",
  brief: "Tone for this message: brief. The fewest words that carry it.",
};

export function draftSystemPrompt(person: PersonData, tone: DraftTone, about: string | undefined): string {
  const audience = person.flagged
    ? "This recipient is marked handle-with-care: clean, guarded, professional prose, whatever else applies."
    : person.register === "friend"
      ? "The recipient is marked close friend: loosest structure per the style rules."
      : person.register === "casual"
        ? "The recipient is marked casual."
        : person.register === "professional"
          ? "The recipient is marked professional: clean standard prose."
          : "The recipient's register is unknown: use the clean version.";
  return [
    JARVIS_VOICE,
    STYLE_SCOPE_RULE,
    `Task: draft ONE text message from the user to ${person.name}.`,
    audience,
    TONE_RULE[tone],
    about ? `What the message needs to say: ${about}` : "No topic was given: draft a short, natural check-in that fits the relationship. Do not invent events, plans, or facts.",
    "Reply with ONLY the message text. No quotes, no preamble, no sign-off unless the register calls for one.",
  ].join("\n");
}

// sms: deep link with the drafted body. iOS accepts "&body=", and the number
// keeps only digits and +. An empty number still opens the composer.
export function smsLink(phone: string | undefined, body: string): string {
  const num = (phone ?? "").replace(/[^+\d]/g, "");
  return `sms:${num}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
}
