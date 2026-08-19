import { JARVIS_VOICE } from "../ai/voice";
import { noDashes } from "../ai/suggestions";

// BREAK IT DOWN (Dave 2026-08-19, ADHD round: "the more I can do and feel
// like I didn't have to think, the better").
//
// One intimidating task becomes three or four small ones that can each be
// started without deciding anything. This is deliberately NOT First Step:
// First Step names the single smallest opening move on something already
// stuck; Break It Down splits a task that is merely big, before it ever gets
// stuck. Different moment, different output shape (a list, not a sentence).
//
// The parser is total: a model that returns prose, numbering, bullets, or
// nothing at all still yields a usable list or an empty one, never a throw.

export function breakdownPrompt(what: string, identity = ""): { system: string; user: string } {
  const system = [
    JARVIS_VOICE,
    "Task: split one job into the smallest concrete steps that each get done in one sitting.",
    "Rules: 3 or 4 steps, never more. Each step starts with a verb and names a physical action.",
    "No step may be 'plan', 'think about', 'organize', or 'figure out': those are the thing being avoided.",
    "Return ONLY the steps, one per line, no numbering, no bullets, no preamble.",
    identity ? "About the person: " + identity : "",
  ].filter(Boolean).join("\n");
  return { system, user: "Break this into steps: " + what };
}

export function parseBreakdown(raw: string): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((l) => noDashes(l).trim())
    // Strip whatever list furniture the model reached for anyway.
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .map((l) => l.replace(/^["']|["']$/g, "").trim())
    .filter((l) => l.length > 1 && l.length <= 120)
    // A model that ignores "no preamble" usually leads with a sentence that
    // ends in a colon; it is never a step.
    .filter((l) => !/:$/.test(l))
    .slice(0, 4);
}
