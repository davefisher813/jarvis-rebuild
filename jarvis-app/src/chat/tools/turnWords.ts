// THREE SMALL JUDGEMENTS ABOUT A TURN'S WORDS (chat box order, 2026-10-24), all pure, all in code where a prompt cannot argue with them.
//
// 1. WHEN THE MODEL SAYS IT DID SOMETHING. In the tool lane no tool changes anything: a change is a card the person taps, made by the app.
//    So a first-person "I've moved it" from the model is never true, and law 3 ("action claims render ONLY from dispatcher states, never
//    from the model's words") means it is never shown. screenClaims takes the claiming sentences out of the model's text and says, from what
//    the dispatcher actually did (a card is waiting, one was already made, or nothing was), where the person stands.
//
//    This is a backstop, and it is built to be hard to talk around rather than to be perfect: it works a sentence at a time, it does not
//    depend on which tools ran (an unrelated lookup in the same turn switches nothing off), and a turn that is about changing something
//    reads more strictly than a plain question. What cannot be caught by words is held by structure: nothing the model writes makes a
//    change, and the receipts in the thread are drawn by the app from what it made.
//
// 2. WHEN A SENTENCE IS A CHANGE TO SOMETHING THAT EXISTS. "Move the plumber to Friday" is not a question, so the chat used to file it as
//    a new task named "Move the plumber to Friday". With the tools on, a sentence that opens with a verb that can only mean changing an
//    existing thing goes to the model, which can search for the task and put the change on a card. Everything else keeps its old road, and
//    the commands the app reads itself (complete, today and tomorrow, delete) are read first, as always.
//
// 3. WHEN A SENTENCE ASKS FOR A CHANGE AT ALL (a new task, a decision, an edit, a "yes, do it"), so the first judgement reads that turn's
//    answer strictly, whichever road the sentence took.

// The verbs of finished work. "set" carries its own exception, because "I set up a card for you" is true.
const DONE_VERBS = "added|created|saved|moved|rescheduled|pushed|updated|changed|renamed|completed|finished|marked|deleted|removed|cleared|sent|filed|scheduled|booked|logged|recorded|captured|set(?!\\s+up\\b)";
const ADVERBS = "(?:(?:just|now|already|also|then|successfully|finally|went\\s+ahead\\s+and)\\s+)*";

// Claims that are claims in any turn: the assistant speaking of its own finished work, or the bare receipt word opening a reply.
const ALWAYS: RegExp[] = [
  // "I added", "I've moved", "I have just marked", "we've saved" (but not "I moved on to your schedule")
  new RegExp(`\\b(?:i|we)(?:'ve|\\s+have)?\\s+${ADVERBS}(?:${DONE_VERBS})\\b(?!\\s+on\\b)`, "i"),
  // "Done.", "Added!", "Saved: call the plumber", "All set"
  /^\s*(?:done|all set|all done|added|saved|moved|updated|marked|deleted|sent)\s*(?:[.!:,;]|\s-\s|$)/i,
];

// Claims in a turn that is about changing something: the speaker left out, which is how a model reports its own work.
const WHEN_CHANGING: RegExp[] = [
  // "Moved the plumber task to Friday.", "Added 'Call the plumber' to your list."
  new RegExp(`^\\s*(?:${DONE_VERBS})\\b`, "i"),
  // "It has been moved", "they have now been saved"
  new RegExp(`\\b(?:has|have)\\s+(?:(?:now|just|also|already)\\s+)*been\\s+(?:${DONE_VERBS})\\b`, "i"),
  // "It's done", "that's now on your list"
  /\b(?:it'?s|that'?s|is)\s+(?:now\s+)?(?:done|complete|completed|on your (?:list|calendar|schedule))\b/i,
];

// A promise of a card that is not there: "I put it on a card", "tap Move Task to confirm" when nothing is waiting.
const CARD_POINTER = /\b(?:tap|press)\b[^.!?]*\b(?:confirm|button|card|approve)\b|\bcard\b[^.!?]*\b(?:below|above|waiting|ready|button|tap|confirm)\b|\b(?:i|we)(?:'ve|\s+have)?\s+(?:put|placed|lined up|set up|made|created|drafted|prepared)\b[^.!?]*\bcard\b/i;

// "Nothing has been changed yet" is the honest answer, and the one the model is told to give: a negative subject before the claim, in the
// same clause, or "nothing" straight after the verb ("I added nothing").
const NEGATIVE_BEFORE = /\b(?:nothing|nobody|no one|none)\b[^,;:]*$/i;
const NOTHING_AFTER = /^\s+(?:nothing|no\b|none\b)/i;

// Sentences, with their ends and spaces kept, and line breaks kept as pieces of their own, so what is left reads as it was written.
const PIECES = /[^.!?\n]+[.!?]*[ \t]*|\n+/g;

function claimIn(sentence: string, strict: boolean, cardWaiting: boolean): boolean {
  for (const re of strict ? [...ALWAYS, ...WHEN_CHANGING] : ALWAYS) {
    const m = re.exec(sentence);
    if (!m) continue;
    if (NEGATIVE_BEFORE.test(sentence.slice(0, m.index)) || NOTHING_AFTER.test(sentence.slice(m.index + m[0].length))) continue;
    return true;
  }
  return strict && !cardWaiting && CARD_POINTER.test(sentence);
}

/**
 * Does any sentence of the text say, as done, a change that no tool made? `strict` for a turn that is about changing something. (A pointer
 * to a card is judged against the cards that exist, which only screenClaims knows, so it is not counted here.)
 */
export function claimsDone(text: string, strict = true): boolean {
  return (text.match(PIECES) ?? []).some((piece) => claimIn(piece, strict, true));
}

/** Where this turn's cards stand when it ends: how many it put up, how many still wait for a tap, how many the person has already made. */
export interface CardTally { opened: number; waiting: number; made: number }

/**
 * What the thread says in place of a claim that something was done: the person is told where they actually stand. Null when the turn left
 * nothing to say (the cards were made or set aside while the model was still talking, and their own lines already said so).
 */
export function notDoneLine(cards: CardTally): string | null {
  if (cards.waiting > 0) return cards.made > 0 ? "Waiting for your OK on the card below" : "Waiting for your OK on the card below · Nothing has changed yet";
  if (cards.opened === 0) return "Nothing was changed · Ask again and I'll put it on a card for you to confirm";
  return null;
}

/**
 * The model's words with any claiming sentence taken out and the truth said instead. `screened` is false (and the text untouched) when
 * nothing claimed anything. The text may come back empty: nothing is left to say.
 */
export function screenClaims(text: string, cards: CardTally, strict: boolean): { text: string; screened: boolean } {
  const pieces = text.match(PIECES) ?? [];
  const kept = pieces.filter((p) => /^\n+$/.test(p) || !claimIn(p, strict, cards.waiting > 0));
  if (kept.length === pieces.length) return { text, screened: false };
  return { text: [kept.join("").trim(), notDoneLine(cards)].filter(Boolean).join("\n"), screened: true };
}

// "please", "can you", "could you (please)", "would you", "I need you to": the ways a request wraps its verb.
const ASK = "^\\s*(?:please\\s+)?(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|i\\s+(?:need|want|would\\s+like)\\s+you\\s+to\\s+)?";

// Verbs that, opening a sentence, can only mean changing something that exists. "mark", "clear" and "change" only with what they change: "mark
// Sarah's birthday on the calendar", "clear the gutters" and "change the oil" are new things and keep the capture lane. "make", "set",
// "update" and "add" are left out for the same reason.
// A few words may sit between the verb and what it changes ("change the plumber task's priority").
const SOME_WORDS = "(?:[\\w'\u2019-]+\\s+){0,5}?";
const EDITS: RegExp[] = [
  new RegExp(`${ASK}(?:move|push|reschedule|postpone|delay|bump|rename|reword|retitle|unmark)\\b`, "i"),
  new RegExp(`${ASK}mark\\b.*\\b(?:done|complete|completed|finished|high|low|important|urgent|priority|normal)\\b`, "i"),
  new RegExp(`${ASK}clear\\s+(?:the\\s+)?${SOME_WORDS}(?:due\\s+)?(?:date|deadline|priority)\\b`, "i"),
  new RegExp(`${ASK}change\\s+(?:the\\s+)?(?:${SOME_WORDS}(?:due\\s+)?(?:date|deadline|priority|name|title|words)|time)\\b`, "i"),
];

// A line of pasted text that happens to begin with one of those words is a paste, not a request.
const SHORT_ENOUGH = 240;

export function looksLikeEdit(text: string): boolean {
  return text.length <= SHORT_ENOUGH && !text.includes("\n") && EDITS.some((re) => re.test(text));
}

const CREATES = new RegExp(`${ASK}(?:add|create|make|save|remind|log|record|note|capture|schedule|book|put|set)\\b`, "i");
// "yes", "do it", "go ahead": the answer to an offer to act.
const GO_AHEAD = /^\s*(?:yes|yeah|yep|yup|ok|okay|sure|do it|go ahead|please do|confirm|approved?)\b/i;

/** Is this sentence asking for something to be changed, made or saved (so the answer is read for claims strictly)? Routing does not use it. */
export function asksForChange(text: string): boolean {
  return text.length <= SHORT_ENOUGH && (looksLikeEdit(text) || CREATES.test(text) || GO_AHEAD.test(text));
}
