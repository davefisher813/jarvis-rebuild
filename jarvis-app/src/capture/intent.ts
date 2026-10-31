// WHAT THE LINE IS FOR, BEFORE IT IS FILED (the speech box, 2026-10-31).
//
// Two kinds of line must never reach the filing lanes, because a lane can only
// make a record and these are not records to make:
//
//   A QUESTION is answered. "What is on my schedule tomorrow?" was saved as a
//   Note holding "No Events Found" (the 2026-10-28 test, twice). The box hands
//   it to Chat, which answers from the records.
//   A WORKOUT SET is logged into training (capture/spokenSet.ts).
//
// Everything else goes on to the lanes exactly as it did.

// A wh-question names what it asks about in its second word: "what time", "when is", "how much". "When I get home call
// Mom" does not, and stays a capture.
const WH = /^(what|when|where|who|whose|which|how|why)(?:'s|\s+(?:is|are|was|were|do|does|did|can|could|should|will|would|have|has|had|am|time|day|date|days|much|many|long|far|often|about|else|did|happened|happens))\b/;
// A yes/no question puts its verb before a subject: "is my", "do I", "are there". "Do the laundry" has no subject after
// the verb, and stays a capture.
const YESNO = /^(is|are|was|were|do|does|did|can|could|should|will|would|have|has|am)\s+(i|my|we|our|you|your|there|it|he|she|they|anything|anyone|someone|any)\b/;
// A request phrased as a question is a request. "Can you remind me to call Mom?" files a reminder; it is not asked.
const REQUEST = /^(?:hey\s+)?(?:jarvis[,\s]+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:remind|add|create|make|schedule|set|put|log|book|move|note|save|track|file|remember|draft|write|plan)\b/;

export function readQuestion(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/^(?:hey\s+)?jarvis[,\s]+/, "");
  if (!t || REQUEST.test(t) || /^remind me\b/.test(t)) return false;
  // A line that is clearly a note with a question in it (long prose) is kept as written.
  if (t.length > 200) return false;
  return /\?\s*$/.test(t) || WH.test(t) || YESNO.test(t);
}
