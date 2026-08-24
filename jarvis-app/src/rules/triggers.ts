// WHAT A CORRECTION IS ABOUT (2026-08-24).
//
// recordCorrection takes a `from`: the trigger a rule keys on. types.ts gives
// the doctrine's own example, "practice" means Elite Squad, so the trigger is
// a PHRASE inside the captured text, not the whole text and not the category
// JARVIS guessed.
//
// Two obvious answers are both wrong:
//
//   - The whole captured text. Safe, and useless: nobody pastes the same
//     sentence twice, so a rule needing two identical corrections would never
//     be born.
//   - The category JARVIS guessed. Useful, and wrong: "JARVIS says Work, he
//     means Family" would fire on every unrelated capture that landed in
//     Work, which is the generalizing the doctrine forbids.
//
// So: the proper noun. "Elite Squad practice on Tuesday" keys on "Elite
// Squad", which is the thing that actually decides the category, repeats
// across captures, and is narrow enough that a rule about it cannot bleed.
//
// Nothing here guesses. If there is no proper noun the answer is null, the
// correction is not recorded, and JARVIS learns nothing from it rather than
// learning something shaky. Rules are only worth having if they are right.

// Words that start a sentence and are capitalised for that reason alone, plus
// the ones that begin most captures. A trigger built from these would key on
// grammar rather than on anything about the user's world.
const NOT_A_NAME = new Set([
  "a", "an", "the", "i", "im", "ive", "id", "ill", "my", "me", "we", "our",
  "add", "call", "email", "text", "book", "buy", "pay", "send", "meet", "get",
  "go", "take", "make", "check", "ask", "tell", "need", "have", "set", "put",
  "remind", "schedule", "plan", "finish", "start", "review", "draft", "fix",
  "reply", "forward", "confirm", "cancel", "move", "push", "follow", "order",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "today", "tomorrow", "tonight", "next", "this", "morning", "afternoon",
  "evening", "am", "pm", "at", "on", "in", "for", "with", "to", "and", "or",
]);

const isCapped = (w: string) => /^[A-Z][A-Za-z'’-]*$/.test(w);
const bare = (w: string) => w.replace(/[^A-Za-z'’-]/g, "").toLowerCase();

// The longest run of consecutive capitalised words that is not grammar.
// Longest, not first, because "Call Elite Squad" should key on the squad and
// not on the verb, and a two-word name beats a one-word one when both appear.
export function aliasTrigger(text: string): string | null {
  const words = text.trim().split(/\s+/);
  let best: string[] = [];
  let run: string[] = [];
  for (let i = 0; i < words.length; i++) {
    // Trailing punctuation comes off BEFORE the test, not after: "Fields:"
    // is a capitalised word wearing a colon, and testing it with the colon
    // attached silently ended the run one word early.
    const w = words[i]!.replace(/^[^A-Za-z'’-]+|[^A-Za-z'’-]+$/g, "");
    if (!w) { run = []; continue; }
    // A word only counts if it is capitalised AND is not one of the words
    // that are capitalised for grammatical reasons. The very first word of a
    // capture is capitalised by habit whatever it is, so it has to clear the
    // same bar as the rest, which the NOT_A_NAME list is what does.
    const ok = isCapped(w) && !NOT_A_NAME.has(bare(w)) && bare(w).length > 1;
    if (ok) {
      run.push(w);
      if (run.length > best.length) best = [...run];
    } else {
      run = [];
    }
  }
  return best.length ? best.join(" ") : null;
}
