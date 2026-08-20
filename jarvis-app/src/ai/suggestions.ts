import { JARVIS_VOICE } from "./voice";
import type { AIContext } from "./context";
import { contextToText } from "./context";
import { titleCase } from "../shared/casing";

// Asks the model for up to two short, grounded nudges for the user's day.
export function suggestionsSystemPrompt(ctx: AIContext, today: string, avoid: string[] = []): string {
  return [
    JARVIS_VOICE,
    "Task: suggest what the user should focus on right now.",
    `Today is ${today} (ISO).`,
    "Ground every suggestion in their real tasks, schedule, people, and birthdays below.",
    "Always write clock times in 12-hour format with AM/PM (e.g., 7:30 PM). Never use 24-hour time.",
    "Style: write each suggestion in Title Case (Capitalize Major Words). No trailing period. Never use em dashes or hyphens as separators; use a colon or comma instead.",
    "Reply with ONLY a JSON array of at most 2 objects, no prose, no code fences.",
    "Each object: {\"text\": string (max ~12 words, Title Case), \"task\": string or null}.",
    "Set task to the EXACT text of the open task the suggestion is about, or null if it is not about a specific task.",
    "If nothing is genuinely useful, reply with an empty array: [].",
    avoid.length ? "Do NOT repeat or rephrase these recent suggestions: " + JSON.stringify(avoid) : "",
    "",
    "User context:",
    contextToText(ctx),
  ].join("\n");
}

// Hard style guarantees, applied even if the model ignores instructions:
// em dashes become colons, and trailing periods are dropped, so AI text can
// never break the app's voice rules.
// The narrow version: em dashes only, punctuation otherwise untouched.
// Anything the model writes that a human will READ goes through this, because
// no amount of prompt instruction stops a model reaching for an em dash, and
// the app has one hard rule about them. Trailing periods survive here: a
// summary that ends mid-air reads broken.
export function noDashes(s: string): string {
  return s.replace(/\s*\u2014\s*/g, ", ").replace(/\s+--\s+/g, ", ");
}

export function scrubStyle(s: string): string {
  const cleaned = s
    .replace(/\s*\u2014\s*/g, ": ")
    .replace(/\s*--\s*/g, ": ")
    .replace(/[.\u3002]+$/g, "")
    .trim();
  // The prompt asks for Title Case and models over-apply it, capitalising the
  // small words too ("Push The Rob Proposal Forward This Afternoon"). The app
  // has one Title Case implementation and it knows the small-word rule, so
  // the model's answer is NORMALISED here rather than trusted.
  return titleCase(cleaned);
}

export interface Suggestion { text: string; task: string | null }

export function parseSuggestions(raw: string): Suggestion[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) {
      const out: Suggestion[] = [];
      for (const item of arr) {
        if (typeof item === "string" && item.trim()) {
          out.push({ text: scrubStyle(item), task: null }); // old-shape tolerance
        } else if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
          const o = item as { text: string; task?: unknown };
          out.push({ text: scrubStyle(o.text), task: typeof o.task === "string" && o.task.trim() ? o.task : null });
        }
      }
      return out.filter((x) => x.text.length > 0).slice(0, 2);
    }
  } catch {
    /* not JSON */
  }
  return [];
}
