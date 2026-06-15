import type { AIContext } from "./context";
import { contextToText } from "./context";

// Asks the model for up to two short, grounded nudges for the user's day.
export function suggestionsSystemPrompt(ctx: AIContext, today: string): string {
  return [
    "You are JARVIS. Suggest what the user should focus on right now.",
    `Today is ${today} (ISO).`,
    "Ground every suggestion in their real tasks, schedule, people, and birthdays below.",
    "Always write clock times in 12-hour format with AM/PM (e.g., 7:30 PM). Never use 24-hour time.",
    "Reply with ONLY a JSON array of at most 2 short strings (max ~12 words each), no prose, no code fences.",
    "If nothing is genuinely useful, reply with an empty array: [].",
    "",
    "User context:",
    contextToText(ctx),
  ].join("\n");
}

export function parseSuggestions(raw: string): string[] {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const arr = JSON.parse(cleaned);
    if (Array.isArray(arr)) {
      return arr.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim()).slice(0, 2);
    }
  } catch {
    /* not JSON */
  }
  return [];
}
