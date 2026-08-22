import { JARVIS_VOICE } from "../ai/voice";

// Hand off: not everything in your inbox is yours.
//
// One gesture forwards a thread to a person you know, with a short note
// already written, and files the thread under Waiting On so it leaves your
// head without leaving your life. Delegation is normally three decisions (who,
// what to say, how to remember), this is one.
//
// Laws: nothing sends without a tap, and the note is a proposal, editable.

export interface HandoffTarget {
  name: string;
  email: string;
  relationship?: string;
}

// People with an email are the only ones who can receive a handoff. Sorted by
// name so the list is predictable rather than mysteriously ranked.
export function handoffTargets(
  people: { data: { name?: string; email?: string; relationship?: string } }[],
): HandoffTarget[] {
  const out: HandoffTarget[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    const email = (p.data.email || "").trim().toLowerCase();
    const name = (p.data.name || "").trim();
    if (!email || !name || seen.has(email)) continue;
    seen.add(email);
    out.push({ name, email, ...(p.data.relationship ? { relationship: p.data.relationship } : {}) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// The fallback note, used verbatim when there is no AI. Short on purpose: a
// long forwarding note is the sender doing the work twice.
export function defaultNote(target: HandoffTarget, subject: string): string {
  return target.name + ", can you take this one? " + subject.trim() + ". Thanks.";
}

// The note is sent over the USER'S name, so like the nudge it now inherits
// JARVIS_VOICE and, when available, the writing voice plus STYLE_SCOPE_RULE
// (Brain Personalization Phase 3). "in the sender's own plain voice" was an
// instruction the model had no way to follow: it was never shown that voice.
// `voice` stays optional so the note still drafts without context.
export function handoffPrompt(target: HandoffTarget, subject: string, gist: string, voice = ""): { system: string; user: string } {
  return {
    system: [
      JARVIS_VOICE,
      "You write one short forwarding note, in the sender's own plain voice. " +
      "Two sentences maximum. No greeting block, no signature, no subject line. " +
      "Never apologise, never explain why it is being forwarded, never say 'per my last email'. " +
      "Output only the note.",
      voice.trim() ? "\nWrite it as this person would write it:\n" + voice.trim() : "",
    ].filter(Boolean).join("\n"),
    user:
      "Forward this to " + target.name +
      (target.relationship ? " (" + target.relationship + ")" : "") +
      ".\nSubject: " + subject +
      (gist ? "\nWhat it is: " + gist : "") +
      "\nAsk them to handle it.",
  };
}

// The subject a forwarded thread carries. Never stacks Fwd: on Fwd:.
export function forwardSubject(subject: string): string {
  return /^fwd?:/i.test(subject.trim()) ? subject.trim() : "Fwd: " + subject.trim();
}

// What the user is told afterwards. It names the person, because the point of
// handing off is knowing who has it now.
export function handoffLine(name: string): string {
  return "Sent to " + name + " · Now in Waiting On";
}
