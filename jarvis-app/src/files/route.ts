// UP-PLAT-08 (2026-09-06), A23: "file uploads to Supabase Storage with
// content routing." Chat has an attach button now, and this is the part that
// decides where the file goes.
//
// DETERMINISTIC FIRST, the same rule every other AI surface in this app
// follows. A photo the person calls a receipt is a receipt; a PDF they call
// the season schedule is a schedule. Only a file that says nothing about
// itself is worth spending a vision call on, and even then the caller makes
// that call, not this module: this is pure, so the routing can be argued with
// in a test instead of in production.
//
// The four destinations are the four places the app already has: Money's
// receipts, the schedule distillation, the gym program uploader, and a note.
// A note is the floor, not a bin: everything is readable, findable and
// re-filable from there, so an undecided file is never lost.

export type FileDestination = "money" | "schedule" | "gym" | "note";

export interface FileRoute {
  to: FileDestination;
  /** What decided it, in the words the receipt bubble shows. */
  why: string;
}

export interface RouteInput {
  name: string;
  mime: string;
  /** What the person typed alongside the file, if anything. */
  text?: string;
}

// The person's own words beat everything else: they are the only signal that
// knows what the file is FOR.
const SAYS: { to: FileDestination; words: RegExp; why: string }[] = [
  { to: "money", words: /\b(receipt|invoice|bill|expense|refund)\b/i, why: "You called it a receipt" },
  { to: "schedule", words: /\b(schedule|season|calendar|fixtures?|itinerary|roster)\b/i, why: "You called it a schedule" },
  { to: "gym", words: /\b(workout|training|program|programme|lifts?|routine)\b/i, why: "You called it a workout" },
];

// The filename says the same things less certainly, so it is checked second
// and only on the stem.
const NAMED: { to: FileDestination; words: RegExp; why: string }[] = [
  { to: "money", words: /receipt|invoice|expense/i, why: "The filename says receipt" },
  { to: "schedule", words: /schedule|season|calendar|fixture|itinerary/i, why: "The filename says schedule" },
  { to: "gym", words: /workout|training|program|lifting/i, why: "The filename says workout" },
];

// A date in the filename, which is what a season schedule PDF almost always
// carries: "Fall-2026.pdf", "2026-09-06.pdf", "Sept 6.pdf".
const DATEY = /(\b20\d{2}\b|\b\d{1,2}[-_/]\d{1,2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/i;

export function isPdf(mime: string, name: string): boolean {
  return mime === "application/pdf" || /\.pdf$/i.test(name);
}

/**
 * Where this file belongs, or null when nothing here can honestly say. Null
 * is the signal for the caller's one vision call; it is not a failure.
 */
export function routeFile(input: RouteInput): FileRoute | null {
  const said = (input.text ?? "").trim();
  for (const r of SAYS) {
    if (r.words.test(said)) return { to: r.to, why: r.why };
  }
  const stem = input.name.replace(/\.[^.]+$/, "");
  for (const r of NAMED) {
    if (r.words.test(stem)) return { to: r.to, why: r.why };
  }
  // A PDF with a date in its name is a schedule far more often than it is
  // anything else this app can do something with. A PDF with no date at all
  // stays undecided rather than being guessed at.
  if (isPdf(input.mime, input.name) && DATEY.test(stem)) {
    return { to: "schedule", why: "A PDF with dates in its name" };
  }
  return null;
}

/**
 * Reads the model's one-word answer from the vision fallback. Anything that
 * is not one of the four destinations is not an answer, and the caller falls
 * back to a note rather than acting on a shrug.
 */
export function parseRouteAnswer(raw: string): FileDestination | null {
  const word = raw.toLowerCase().replace(/[^a-z]/g, " ").trim().split(/\s+/)[0] ?? "";
  return word === "money" || word === "schedule" || word === "gym" || word === "note" ? word : null;
}

// The one prompt for the fallback, here beside the parser that reads it.
export const ROUTE_PROMPT =
  "Look at this file and answer with ONE word, nothing else: "
  + "money if it is a receipt, an invoice or a bill; "
  + "schedule if it is a calendar, a season schedule or a list of dated events; "
  + "gym if it is a workout, a training program or a list of exercises; "
  + "note for anything else.";

// Where the receipt bubble says it went. Title Case: these name a place.
export const DESTINATION_LABEL: Record<FileDestination, string> = {
  money: "Money",
  schedule: "Schedule",
  gym: "Gym",
  note: "Notes",
};
