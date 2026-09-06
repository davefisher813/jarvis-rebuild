import type { Evidence } from "./evidence";
import { isMachineAddress } from "./noReply";

// CONFIDENCE DECIDES WHAT HAPPENS ON ITS OWN (UP-MIND-18, Email T1 and 5.7).
//
// Nothing in this app carried a confidence. The automation gates were AI
// Control LEVEL only, so at Everything a claim the model was sure of and a
// claim it half-guessed drove exactly the same automatic action. That is the
// rule that has to exist before Everything mode is safe to leave on.
//
// TWO STATES, and only two. A number would invite arithmetic on it and a
// slider would invite tuning it; the question is only ever "may this happen
// without me", which is a yes or a no.
//
// GROUNDED, NEVER SELF-REPORTED. A model asked to score itself says 0.9
// about a sentence it invented. So confidence is derived from the evidence
// triple (evidence.ts): the model quoted the email, and the quote was found
// verbatim in a body we actually fetched, or it did not. High means there is
// a sentence a person can tap and read. Low renders hedged and drives
// nothing automatic, at any AI Control level.
//
// Every threshold this feature has lives in this file.

export type Confidence = "high" | "low";

/** The confidence of a claim, from its evidence and nothing else. */
export function confidenceOf(ev: Evidence | null | undefined): Confidence {
  return ev && ev.confidence === "high" && !!ev.span.trim() ? "high" : "low";
}

export function isHigh(c: Confidence): boolean {
  return c === "high";
}

// The hedge. A claim without a sentence behind it is still worth showing:
// what changes is that it stops speaking with certainty. "Friday" becomes
// "Looks like Friday", which is the honest version of the same fact.
export function hedge(label: string): string {
  const t = (label || "").trim();
  if (!t) return t;
  // Already hedged (the app said it, or the sender's own phrase is a hedge).
  if (/^(looks like|maybe|probably)\b/i.test(t)) return t;
  return "Looks like " + t.charAt(0).toLowerCase() + t.slice(1);
}

/** The label as it should read: plain when the claim can show its sentence,
 *  hedged when it cannot. */
export function labelFor(label: string, ev: Evidence | null | undefined): string {
  return isHigh(confidenceOf(ev)) ? label : hedge(label);
}

// NOISE IS A DIFFERENT KIND OF CLAIM, and it needs its own grounding.
//
// A bucket has no span: the model did not quote anything to call a
// newsletter a newsletter, so "span present" would make every noise row low
// and Everything mode would archive nothing, which is not a safety
// improvement, it is a broken feature.
//
// What grounds a noise call is corroboration from OUTSIDE the model: the
// address is a machine's (no-reply, notifications, mailer daemons, the
// pattern set noReply.ts already owns), or the user's own sender rule put it
// there. Either is a fact the app can check. A thread the model alone called
// noise still renders in the Noise pile and still archives on a tap; it just
// does not get archived while nobody is looking.
export interface NoiseClaim {
  fromEmail: string;
  /** True when a sender rule the user wrote put this row in noise. */
  byRule?: boolean;
}

export function noiseConfidence(c: NoiseClaim): Confidence {
  if (c.byRule) return "high";
  return isMachineAddress(c.fromEmail || "") ? "high" : "low";
}

/** The rows an unattended archive-all may take. The manual sweep takes
 *  everything: a tap is the user saying they looked. */
export function autoArchivable<T extends { fromEmail: string; id: string }>(
  noise: T[],
  ruled: (id: string) => boolean = () => false,
): T[] {
  return noise.filter((r) => isHigh(noiseConfidence({ fromEmail: r.fromEmail, byRule: ruled(r.id) })));
}
