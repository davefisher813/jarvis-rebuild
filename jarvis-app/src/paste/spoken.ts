// HOW SPEECH IS WRITTEN DOWN (the speech box, 2026-10-31).
//
// Dave said "Dinner with Marco Thursday 7:00 PM" into the app on 2026-10-28
// and it was filed as a Note. The words arrived from transcription as
// "7 p.m.", and the capture rules only read "7pm" and "7:00 PM", so the line
// lost its time, read as an undated task, and the model filed it as a note.
// The failure was the spelling, not the hearing.
//
// This turns the ways speech-to-text spells things into the ways the rules
// already read them, and nothing else. It never guesses a value: a bare
// "at seven" with no am or pm stays as it is, because which seven is not
// written anywhere. Typed lines pass through it too, so the same words read
// the same whichever way they came in.

const NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const MIN: Record<string, string> = { "o'clock": "00", oclock: "00", fifteen: "15", thirty: "30", "forty five": "45", "forty-five": "45" };
const WORD = Object.keys(NUM).join("|");

export function normalizeSpoken(line: string): string {
  let t = line;
  // "7 p.m.", "7 p. m.", "7 P.M" -> "7 pm". Only after a digit or a number
  // word, so "a.m." elsewhere in a sentence is left alone.
  t = t.replace(/(\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|o'?clock|fifteen|thirty|forty[- ]five))\s*([ap])\.\s?m\b\.?/gi, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}m`);
  // "seven pm", "seven thirty pm", "seven o'clock pm" -> "7pm", "7:30pm".
  t = t.replace(new RegExp(`\\b(${WORD})(?:\\s+(o'?clock|fifteen|thirty|forty[- ]five))?\\s*(am|pm)\\b`, "gi"), (_m, h: string, mm: string | undefined, ap: string) => {
    const hour = NUM[h.toLowerCase()]!;
    const minutes = mm ? MIN[mm.toLowerCase().replace(/^oclock$/, "o'clock")] ?? "00" : "00";
    return minutes === "00" ? `${hour}${ap.toLowerCase()}` : `${hour}:${minutes}${ap.toLowerCase()}`;
  });
  // "7 30 pm" (a transcript that dropped the colon) -> "7:30 pm".
  t = t.replace(/\b(\d{1,2})\s(\d{2})\s*(am|pm)\b/gi, (_m, h: string, mm: string, ap: string) => (Number(mm) < 60 ? `${h}:${mm} ${ap.toLowerCase()}` : _m));
  // "42 dollars", "42 bucks", "42.50 dollars" -> "$42". Money said aloud.
  t = t.replace(/\b(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks)\b/gi, (_m, n: string) => `$${n}`);
  return t;
}

// THE PART OF THE DAY A REMINDER NAMES ("remind me tomorrow morning"). Read
// only on the reminder lane, where a time is required and "morning" can only
// mean one clock. Morning is the person's own setting (tasks/quickReminder),
// passed in so this file stays pure; the others are fixed and said on the
// receipt, so a wrong one is seen and changed.
export function partOfDayTime(lower: string, morning = "08:00"): { hhmm: string; text: string } | null {
  const m = lower.match(/\b(?:(?:this|tomorrow|in the)\s+)?(morning|afternoon|evening|tonight|night)\b/);
  if (!m) return null;
  const word = m[1]!;
  const hhmm = word === "morning" ? morning : word === "afternoon" ? "14:00" : word === "evening" ? "18:00" : "20:00";
  // "tomorrow" stays in the line so the day read still finds it; only the
  // part-of-day word is the time's own text.
  const text = m[0].replace(/^(?:tomorrow)\s+/, "");
  return { hhmm, text };
}
