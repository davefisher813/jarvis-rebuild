// THE TWO READS A TASK OR AN EVENT CARRIES BESIDES ITS DAY AND TIME (the
// Logging Standard, rule 3, 2026-10-17): how long it takes and which area it
// is for. The task sheet's one line (quickTask.ts) and Smart Paste's
// classifier (paste/deterministic.ts) read them with these same functions,
// so "30 min #Work" means one thing everywhere it is typed.
//
// This module sits apart from quickTask.ts because quickTask reads its day
// and time through quickReminder, which imports paste/deterministic; the
// classifier importing quickTask back would be a cycle. Nothing here imports
// anything, so either side can lean on it.
//
// A word this cannot resolve stays in the title and nothing is guessed for
// it: "#Garage" with no Garage area is left exactly as typed.

export interface DurationRead { minutes: number; text: string }
export interface AreaRead { id: string; text: string }

// "1h", "1 hr", "1.5 hours", "1h30", "1h 30m", "1 hour 15 min", "30 min",
// "30 mins", "45 minutes", "45m". The minutes after an hour need their own
// unit unless they are glued to it ("1h30"), so "1h 2 people" reads one hour
// and leaves the two people alone.
const HOURS_RE = /\b(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b(?:(\d{1,2})\b|\s+(\d{1,2})\s*(?:m|min|mins|minute|minutes)\b)?/i;
const HOURS_GLUED_RE = /\b(\d+)h(\d{2})\b/i;
const MINUTES_RE = /\b(\d+)\s*(?:m|min|mins|minute|minutes)\b/i;
const TAG_RE = /(?:^|\s)#([a-z0-9][a-z0-9_-]*)/i;

/** The length a line names, and the exact words that named it. */
export function readDuration(title: string): DurationRead | null {
  const glued = title.match(HOURS_GLUED_RE);
  if (glued) {
    const minutes = parseInt(glued[1]!, 10) * 60 + parseInt(glued[2]!, 10);
    return minutes > 0 ? { minutes, text: glued[0] } : null;
  }
  const h = title.match(HOURS_RE);
  if (h) {
    const minutes = Math.round(parseFloat(h[1]!) * 60) + parseInt(h[2] ?? h[3] ?? "0", 10);
    return minutes > 0 ? { minutes, text: h[0] } : null;
  }
  const m = title.match(MINUTES_RE);
  if (m) {
    const minutes = parseInt(m[1]!, 10);
    return minutes > 0 ? { minutes, text: m[0] } : null;
  }
  return null;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The area a #tag names, when exactly one area answers to it (case and
 *  space insensitive: "#sideprojects" is Side Projects). `text` is the tag
 *  with the whitespace that led into it, ready for cutWords. */
export function readAreaTag(title: string, categories: { id: string; name: string }[]): AreaRead | null {
  const tag = title.match(TAG_RE);
  if (!tag) return null;
  const want = squash(tag[1]!);
  const hits = categories.filter((c) => squash(c.name) === want);
  return hits.length === 1 ? { id: hits[0]!.id, text: tag[0] } : null;
}

/** The title with one read's words taken out and the seams closed. */
export function cutWords(title: string, text: string): string {
  return title.replace(text, " ").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim().replace(/^[,.\s]+|[,.\s]+$/g, "");
}
