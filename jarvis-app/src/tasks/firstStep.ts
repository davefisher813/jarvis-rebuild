import { JARVIS_VOICE } from "../ai/voice";

// First Step: the smallest possible opening move on something that is stuck.
//
// This prompt lived inline, twice, in two different files: TasksFlow (a task
// that keeps sliding) and BiggerPictureFlow (a project with nothing moving).
// Same feature, same wording, copied. Worse, both called the model with NO
// system prompt at all, so the one JARVIS personality that every other AI
// surface inherits was the one thing this feature was missing, and the voice
// rules in JARVIS_VOICE (no em dashes, never guilt the user about unfinished
// work) were never actually delivered to the model. On a feature that exists
// specifically to speak to someone about a thing they have been avoiding, the
// "never guilt" rule is not decoration.
//
// Brain Personalization Phase 3 (2026-08-07): one builder, one system prompt,
// and the user's identity context so the step suits the person rather than
// being generically reasonable.

export type StuckKind = "task" | "project";

export function firstStepPrompt(what: string, kind: StuckKind, identity = ""): { system: string; user: string } {
  const system = [
    JARVIS_VOICE,
    "Task: name the single smallest first physical step that gets a stuck thing moving.",
    "It must be doable in under a minute, right now, without preparation.",
    "Reply with ONLY that step: under 12 words, no quotes, no preamble, no encouragement, no explanation.",
    "Never mention how long it has been stuck, and never imply the user should have started sooner.",
    "Ground the step in what you know about this person below when it helps. Never invent tools, apps, or people they have not mentioned.",
    identity.trim() ? "\nAbout this person:\n" + identity.trim() : "",
  ].filter(Boolean).join("\n");

  const user = kind === "project"
    ? `The user's project "${what}" has no next action and nothing moving. Give the first step.`
    : `The user keeps putting off this task: "${what}". Give the first step.`;

  return { system, user };
}

// The model was asked for one line. Take the first non-empty one and ignore
// any bonus commentary; an empty result is a failure, not a blank suggestion.
export function parseFirstStep(raw: string): string | null {
  const line = raw.trim().split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;
  return line.replace(/^["']|["']$/g, "").trim() || null;
}
