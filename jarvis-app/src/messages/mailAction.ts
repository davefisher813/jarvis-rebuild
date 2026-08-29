// WHAT IS MY NEXT MOVE ON THIS THREAD (2026-08-21).
//
// Dave, looking at four Waiting On rows that all said "Ask To Call":
// "the email buttons are not working properly they will all say the exact
// same action instead of appropriate ones."
//
// He was right, and the cause was structural rather than cosmetic. The old
// ladder derived its label from the WAIT ALONE: past twenty-one days every
// thread reached the top rung, and every thread in a real inbox is weeks old.
// A previous pass tried to fix it by splitting the top rung on whether a
// phone number exists, which renamed the identical button without making it
// different.
//
// The button was asking "how long has it been" when it should ask "what am I
// waiting FOR". Those are different questions and only the second one has
// different answers per row.
//
// So: the ASK decides the action, and the WAIT decides the tone of the draft.
// The ladder's good idea survives; it was just wired to the wrong input.
//
// The payoff is the ADHD one. When every row's button is different, reading
// four buttons replaces reading four emails.

export type AskKind =
  | "money_in"    // they owe you money, or owe you word about money
  | "goods"       // an order went wrong: missing, damaged, undelivered
  | "they_asked"  // THEY asked to be contacted. They named the channel.
  | "answer"      // you asked something and need a human reply
  | "nothing";    // a receipt or confirmation. Owes you nothing.

export type ActionFamily = "reply" | "channel" | "route" | "convert" | "close";

export interface MailAction {
  key: string;
  label: string;                              // Title Case, per catalog H2
  family: ActionFamily;
  channel: "email" | "call" | "text" | "none"; // what the TAP does
  instruction?: string;                        // what the drafter is told
}

// Tone comes from the wait. Same rungs as before, same thresholds, now
// applied to the DRAFT instead of to the label.
export const RUNG_AT = { direct: 7, switch: 21 };
export type Tone = "gentle" | "direct" | "firm";
export function toneFor(waitingDays: number, nudgesSent = 0): Tone {
  if (waitingDays >= RUNG_AT.switch || nudgesSent >= 2) return "firm";
  if (waitingDays >= RUNG_AT.direct || nudgesSent >= 1) return "direct";
  return "gentle";
}
const TONE_NOTE: Record<Tone, string> = {
  gentle: "Assume they are busy",
  direct: "Ask plainly and give a date",
  firm: "Say what you need and by when",
};

// ---- What is this thread ABOUT ----
// Deterministic and cheap: the sender's own words decide, never a guess about
// intent. Runs with the AI off, which the AI-gating law requires.
const RX = {
  theyAsked: /\b(call me|give me a call|can you call|please call|ring me|let'?s talk|hop on a call)\b/i,
  money: /\b(invoice|payment|remittance|past due|balance|amount due|receipt requested|reimburse\w*)\b/i,
  // `order #?\d` USED TO END AT ONE DIGIT (Dave 2026-08-29, from his real
  // inbox). The `\b` closing this group sits right after `\d`, so the rule
  // only ever matched a SINGLE-digit order number: "Order #5" classified as
  // goods, "Order #51161" did not, because after the first "5" comes "1",
  // which is no word boundary at all. Every real order number is multi-digit,
  // so the order-number half of this rule had never fired in production.
  // It survived because the test fixture reads "Missing Items From Order
  // #D2565", which matches on "missing" and never exercises the number.
  // `\d+` consumes the whole number, and the boundary then lands where it
  // was always meant to. `\s*` also allows "order 51161" and "order#51161",
  // and `[a-z]{0,4}` admits the letter-prefixed numbers real vendors use --
  // "Order #D2565", the very format this file's own test fixture carries,
  // which until now only ever matched on the word "Missing" beside it.
  // Bounded at four so "ordering lunch" stays an ordinary thread.
  goods: /\b(missing|damaged|broken|never (arrived|shipped|came)|not received|wrong item|refund|return|order\s*#?\s*[a-z]{0,4}\d+|defect\w*)\b/i,
  nothing: /\b(receipt|confirmation|confirmed|order placed|itinerary|ticket|statement ready|no reply needed|do not reply|noreply)\b/i,
};

export function askKindOf(subject = "", snippet = ""): AskKind {
  const t = `${subject} ${snippet}`;
  // Order matters. Someone who wrote CALL ME has named the channel, and that
  // outranks whatever the thread is nominally about.
  if (RX.theyAsked.test(t)) return "they_asked";
  if (RX.goods.test(t)) return "goods";
  // A receipt only counts as "nothing" when nothing is also wrong with it.
  if (RX.nothing.test(t)) return "nothing";
  if (RX.money.test(t)) return "money_in";
  return "answer";
}

export interface ActionOpts {
  hasPhone?: boolean;
  // Somebody else at the same organisation we could reach instead. This is
  // the move nobody thinks of at 11pm and no other mail app can offer,
  // because no other mail app knows your people.
  altContact?: string | null;
  // The thread carries an amount we could file as a bill.
  billable?: boolean;
  // CAPABILITY GATES (2026-08-21, wiring the alternates onto the swipe).
  // An action is offered only where its handler exists. This is the same law
  // that split Call Them from Ask To Call, applied to the rest of the list:
  // a sheet that prints Add as Task with no task service is a sheet full of
  // buttons that do nothing, which is worse than a shorter sheet.
  canTask?: boolean;
  canSchedule?: boolean;
}

export interface Decision {
  ask: AskKind;
  tone: Tone;
  primary: MailAction;
  // Everything else, for the swipe. One button per row, nothing hidden that
  // matters (Dave's pick 2026-08-21).
  alternates: MailAction[];
  // Said ONCE by the section, never repeated down every row.
  note: string;
}

const A = {
  askStatus: (tone: Tone): MailAction => ({
    key: "ask_status", label: "Ask For Status", family: "reply", channel: "email",
    instruction: `Two sentences asking where this stands. ${TONE_NOTE[tone]}. Do not restate the history.`,
  }),
  escalate: (tone: Tone): MailAction => ({
    key: "escalate", label: "Escalate", family: "reply", channel: "email",
    instruction: `Two sentences naming the problem and the resolution you want. ${TONE_NOTE[tone]}.`,
  }),
  dispute: (): MailAction => ({
    key: "dispute", label: "Open a Dispute", family: "reply", channel: "email",
    instruction: "Two sentences stating you are escalating this to a formal dispute, with the order reference.",
  }),
  askAgain: (tone: Tone): MailAction => ({
    key: "ask_again", label: "Ask Again", family: "reply", channel: "email",
    instruction: `Re-ask in two sentences. ${TONE_NOTE[tone]}. Never mention how many times you have asked.`,
  }),
  answerIt: (): MailAction => ({ key: "answer_it", label: "Answer It", family: "reply", channel: "email",
    instruction: "Answer the question directly in two sentences." }),
  call: (who: string): MailAction => ({ key: "call", label: who, family: "channel", channel: "call" }),
  text: (): MailAction => ({ key: "text", label: "Text Them", family: "channel", channel: "text" }),
  askToCall: (): MailAction => ({
    key: "ask_to_call", label: "Ask To Call", family: "channel", channel: "email",
    instruction: "Two sentences offering a call, with a concrete window this week.",
  }),
  someoneElse: (name: string): MailAction => ({
    key: "someone_else", label: "Ask " + name + " Instead", family: "route", channel: "email",
    instruction: "Two sentences to a colleague of theirs, asking who can help. Never criticise the person who went quiet.",
  }),
  forward: (): MailAction => ({ key: "forward", label: "Forward It", family: "route", channel: "email" }),
  addBill: (): MailAction => ({ key: "add_bill", label: "Add as Bill", family: "convert", channel: "none" }),
  addTask: (): MailAction => ({ key: "add_task", label: "Add as Task", family: "convert", channel: "none" }),
  blockTime: (): MailAction => ({ key: "block_time", label: "Block Time For It", family: "convert", channel: "none" }),
  stop: (): MailAction => ({ key: "stop", label: "Stop Tracking", family: "close", channel: "none" }),
  handled: (): MailAction => ({ key: "handled", label: "Mark Handled", family: "close", channel: "none" }),
  quiet: (): MailAction => ({ key: "quiet", label: "Always Quiet This Sender", family: "close", channel: "none" }),
};

// A phone number turns the top rung into a real dial. Without one, the button
// is honest about being an email that ASKS for a call. Law, since the day the
// button said "Try Calling" and opened a compose window: a label may only
// promise what the handler performs.
const callOrAsk = (opts: ActionOpts): MailAction =>
  opts.hasPhone ? A.call("Call Them") : A.askToCall();

export function decide(
  subjectOrAsk: string | AskKind,
  snippet = "",
  waitingDays = 0,
  nudgesSent = 0,
  opts: ActionOpts = {},
): Decision {
  const ask: AskKind = (["money_in", "goods", "they_asked", "answer", "nothing"] as string[])
    .includes(subjectOrAsk) ? subjectOrAsk as AskKind : askKindOf(subjectOrAsk, snippet);
  const tone = toneFor(waitingDays, nudgesSent);
  const alt = opts.altContact ? A.someoneElse(opts.altContact) : null;
  const dead = tone === "firm";
  // Capabilities default ON: the gate exists to turn an action OFF where its
  // handler is missing, never to require ceremony from the common caller.
  const task = opts.canTask !== false ? [A.addTask()] : [];
  const block = opts.canSchedule !== false ? [A.blockTime()] : [];
  const bill = opts.billable && opts.canTask !== false ? [A.addBill()] : [];
  // Texting needs the same number Call needs. Without one the button opens
  // an empty Messages thread, which is the "Try Calling" bug wearing a
  // different coat.
  const text = opts.hasPhone ? [A.text()] : [];

  let primary: MailAction;
  let alternates: MailAction[];
  let note: string;

  switch (ask) {
    case "nothing":
      // The one that should never have been in the list. A receipt owes you
      // nothing, so the honest button admits the row is a mistake.
      // Mark Handled is NOT offered beside Stop Tracking. Both take the row
      // off the list and neither touches the mail, so shipping them together
      // is two buttons doing one thing, which is the exact complaint that
      // started this file.
      primary = A.stop();
      alternates = [A.quiet(), ...task];
      note = "Nothing owed on these";
      break;
    case "they_asked":
      // They named the channel. Honour it.
      primary = opts.hasPhone ? A.call("Call Them") : A.askToCall();
      alternates = [...text, A.askAgain(tone), ...task, A.handled()];
      note = "They asked you to call";
      break;
    case "goods":
      primary = dead ? A.dispute() : A.escalate(tone);
      alternates = [callOrAsk(opts), ...(alt ? [alt] : []), ...task, A.stop()];
      note = dead ? "Past the point an email helps" : "Something went wrong with an order";
      break;
    case "money_in":
      primary = A.askStatus(tone);
      alternates = [
        ...(alt && dead ? [alt] : []),
        callOrAsk(opts),
        ...bill,
        ...(alt && !dead ? [alt] : []),
        A.stop(),
      ];
      note = "Money is owed to you";
      break;
    default: {
      // THE LAST BRANCH WHERE THE WAIT STILL PICKED THE WORDS (Dave
      // 2026-08-29). This file's own thesis is "the ASK decides the action,
      // and the WAIT decides the tone of the draft", and four of the five
      // branches obey it. This one -- the FALLBACK, which catches every
      // thread the regexes above do not classify, i.e. most mail -- still
      // read `dead ? callOrAsk : askAgain`. Every thread in a real inbox is
      // weeks old, so every one of them was dead, so every one of them said
      // "Ask To Call": the exact complaint at the top of this file,
      // un-fixed in the branch that matters most. Three of the four rows in
      // his screenshot were this line.
      //
      // There is even a law for it, "the wait sets the tone, not the words
      // on the button", and it only ever exercised money_in, which already
      // obeyed. The law's own branch went untested.
      //
      // What survives: a real dial IS a real channel change and deserves to
      // lead when email has stopped working. What does not: "Ask To Call"
      // with no phone number is ITSELF AN EMAIL (see A.askToCall's channel),
      // so it is not a channel change at all, just a differently worded ask
      // -- and letting a fake channel change take the primary slot is what
      // put one label on every aged row. Without a number it steps back to
      // the alternates, where it is still one swipe away.
      const realCall = dead && opts.hasPhone === true;
      primary = realCall ? A.call("Call Them") : A.askAgain(tone);
      alternates = [
        ...(realCall ? [A.askAgain(tone)] : [callOrAsk(opts)]),
        ...(alt ? [alt] : []),
        A.forward(), ...block, A.stop(),
      ];
      note = dead ? "Email has stopped working here" : "Waiting on a reply";
      break;
    }
  }
  // Never offer the same key twice, and never offer the primary again.
  const seen = new Set([primary.key]);
  alternates = alternates.filter((a) => (seen.has(a.key) ? false : (seen.add(a.key), true)));
  return { ask, tone, primary, alternates, note };
}

// WHAT THE TAP DOES, in the fewest words that are still true.
//
// The sheet prints this under every label. It exists because a list of five
// verbs with no consequences attached is a quiz, and a quiz is the thing an
// ADHD user closes without picking. Each string is a promise the handler in
// MessagesFlow has to keep; changing one without changing the other is the
// "Try Calling" bug returning by a side door.
export function promises(a: MailAction): string {
  switch (a.key) {
    case "call": return "Dials now";
    case "text": return "Opens Messages";
    case "forward": return "Starts a forward";
    case "add_bill": return "Files it under Money";
    case "add_task": return "Makes a task";
    case "block_time": return "Books the next free slot";
    case "stop": return "Stops counting the days";
    case "handled": return "Off your list";
    case "quiet": return "Future mail goes quiet";
    default: return a.channel === "email" ? "Drafts an email" : "Off your list";
  }
}

// THE LABEL FOR A SURFACE THAT CAN ONLY DRAFT.
//
// The Today card writes an email and sends it; it cannot dial, file a bill or
// book a slot. W2 says a label may only promise what the handler performs, so
// Today asks for the first action that opens an email rather than printing
// the primary and hoping.
//
// null means the thread has nothing to say. A receipt owes nothing, and it
// does not belong on the home page any more than it belonged in Waiting On.
export function draftableOf(d: Decision): MailAction | null {
  return [d.primary, ...d.alternates].find((a) => a.channel === "email") ?? null;
}
