// TWO SMALL JUDGEMENTS ABOUT A TURN'S WORDS (chat box order, 2026-10-24), both pure, both in code where a prompt cannot argue with them.
//
// 1. WHEN THE MODEL SAYS IT DID SOMETHING. In the tool lane no tool changes anything: a change is a card the person taps, made by the
//    app. So a first-person "I've moved it" from the model is never true, and law 3 ("action claims render ONLY from dispatcher states,
//    never from the model's words") means it is never shown. claimsDone finds the claim; notDoneLine is what the thread says instead,
//    built from what the dispatcher actually did (a card is waiting, or nothing was made).
//
// 2. WHEN A SENTENCE IS A CHANGE TO SOMETHING THAT EXISTS. "Move the plumber to Friday" is not a question, so the chat used to file it as
//    a new task named "Move the plumber to Friday". With the tools on, a sentence that opens with a verb that can only mean changing an
//    existing thing goes to the model, which can search for the task and put the change on a card. Everything else keeps its old road, and
//    the commands the app reads itself (complete, today and tomorrow, delete) are read first, as always.

// A verb in the first person and the past, saying the work is finished. "set" is left out on purpose: "I set up a card for you" is true.
const DONE_VERBS = "added|created|saved|moved|rescheduled|pushed|updated|changed|renamed|completed|finished|marked|deleted|removed|cleared|sent|filed|scheduled|booked|logged|recorded|captured";

const CLAIMS: RegExp[] = [
  // "I added", "I've moved", "I have just marked", "we've saved"
  new RegExp(`\\b(?:i|we)(?:'ve|\\s+have)?\\s+(?:(?:just|now|already|also|then|successfully|finally)\\s+)*(?:${DONE_VERBS})\\b`, "i"),
  // "It has been moved", "they have been saved"
  new RegExp(`\\b(?:has|have)\\s+(?:(?:now|just|also|already)\\s+)*been\\s+(?:${DONE_VERBS})\\b`, "i"),
  // A bare receipt as the first word: "Done.", "Added!", "Saved: call the plumber"
  /^\s*(?:done|all set|all done|added|saved|moved|updated|marked|deleted|sent)\s*(?:[.!:,;]|\s-\s|$)/i,
  // "It's done", "that's now on your list"
  /\b(?:it'?s|that'?s|is)\s+(?:now\s+)?(?:done|complete|completed|on your (?:list|calendar|schedule))\b/i,
];

// A sentence that says it has NOT happened is the honest answer, and the one the model is told to give ("Nothing has been changed yet").
const DENIES = /\b(?:not|nothing|never|yet|no)\b|n't\b/i;

/** Does any sentence of the text say, as done, a change that no tool made? A sentence that denies it is not a claim. */
export function claimsDone(text: string): boolean {
  return text.split(/(?<=[.!?])\s+|\n+/).some((sentence) => !DENIES.test(sentence) && CLAIMS.some((re) => re.test(sentence)));
}

/** What the thread says in place of a claim that something was done: it was not. `waiting` is how many cards this turn left on screen. */
export function notDoneLine(waiting: number): string {
  return waiting > 0
    ? "Waiting for your OK on the card below · Nothing has changed yet"
    : "Nothing was changed · Ask again and I'll put it on a card for you to confirm";
}

// Verbs that, opening a sentence, can only be asking for a change to something already there. "make", "set", "update" and "add" are left
// out: "make dinner reservations" and "add milk" are new things, and they keep the capture lane they always had.
const EDIT_OPENING = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:move|push|reschedule|postpone|delay|bump|rename|reword|retitle|mark|unmark|clear|change)\b/i;

export function looksLikeEdit(text: string): boolean {
  return EDIT_OPENING.test(text);
}
