// CHATTER IS NOT A CAPTURE (J-01, Dave's order of 2026-10-27: "plain chat messages silently becoming tasks").
//
// The chat box answers, acts and captures, and anything that was not a command or a question used to fall into the capture lane,
// where a line the rules could not read became a task: "thanks" a task called Thanks, "hello" a task called Hello, "never mind" a
// rule in the Brain. This is the small deterministic read that keeps conversation out of that lane, BEFORE any AI call. It claims only
// what is plainly talk (a greeting, a thanks, an acknowledgement, a laugh, a feeling, a request addressed to JARVIS); a line that
// might be a thing to do is not claimed, and still goes to the capture lane, which now says so when it cannot read it.
//
// What it answers with is words only. Nothing here writes.

export type ChatterKind = "thanks" | "greeting" | "ack" | "mood" | "request";

export interface Chatter {
  kind: ChatterKind;
  /** The app's own reply, for the kinds that need no model. Absent: the line is a real conversation turn for the AI lane. */
  reply?: string;
}

const norm = (raw: string) => raw.trim().toLowerCase().replace(/[.!,…]+$/g, "").replace(/\s+/g, " ");

const THANKS = /^(thanks|thank you|thx|ty|cheers|much appreciated|appreciate it|thanks (a lot|so much|jarvis)|thank you (so much|jarvis))$/;
const GREETING = /^(hi|hello|hey|yo|howdy|good (morning|afternoon|evening|night)|morning|evening|sup|what's up|whats up)( there| jarvis)?$/;
const ACK = /^(ok|okay|k|kk|cool|nice|great|awesome|perfect|sounds good|got it|gotcha|sure|yes|yeah|yep|yup|no|nope|nah|never ?mind|nvm|forget it|forget that|alright|fine|right|i see|makes sense|that makes sense|good job|well done|wow|oh|ah|hmm+|huh|interesting|lol|lmao|haha+|hehe|ha|true|exactly|agreed|same|oops|whoops|sorry|my bad|stop|cancel)$/;
const FEELING = "tired|exhausted|stressed|overwhelmed|anxious|nervous|worried|happy|sad|bored|hungry|sick|fine|good|great|okay|busy|excited|angry|frustrated|stuck|lost|behind|drained|burned out|burnt out|swamped|annoyed|proud|relieved|calm|sleepy|cold|hot";
const MOOD = new RegExp(`^(i'?m|i am|im|i feel|i'?m feeling|feeling|so|ugh,? i'?m|ugh,? i feel)\\s+(so |really |very |a bit |kinda |pretty |super |too )?(${FEELING})( (today|right now|lately|again|tonight|this morning))?$`);
const REQUEST = /^(tell me|help me|summari[sz]e|explain|describe|show me|give me|walk me through|talk to me|let'?s talk|can you|could you|would you|will you|please)\b/;

export function readChatter(raw: string): Chatter | null {
  const t = norm(raw);
  if (!t || t.length > 120) return null;
  // A line with a time, a date word or a number in it is a thing to do or remember, not talk.
  if (/\d/.test(t)) return null;
  if (THANKS.test(t)) return { kind: "thanks", reply: "Anytime" };
  if (GREETING.test(t)) return { kind: "greeting", reply: "Hi · Ask, tell or paste, and I'll help" };
  if (ACK.test(t)) return { kind: "ack", reply: "Got it · Nothing was saved" };
  if (MOOD.test(t)) return { kind: "mood" };
  if (REQUEST.test(t)) return { kind: "request" };
  return null;
}
