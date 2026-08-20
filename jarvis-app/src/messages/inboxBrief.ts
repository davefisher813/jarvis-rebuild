import type { MailNotice, MailSnapshot } from "./home";
import { capAfterNumber } from "../shared/casing";

// THE MORNING SENTENCE (U5, Dave 2026-08-20).
//
// One line above the email cards that says what the whole inbox IS, so he
// knows the shape before reading a single card. The cards answer "what do I
// do"; this answers "how bad is it", which is the question that actually
// stops people opening their mail.
//
// Laws:
//   - Derived from what the app KNOWS: the notices it already built and the
//     counts behind them. It never characterises what senders "want", because
//     nothing here measures that and a confident wrong summary is worse than
//     no summary.
//   - Silent when there is nothing to summarise. A sentence saying "nothing
//     needs you" is still a thing to read on a page built to be quiet.
//   - It never counts the same thread twice, and it never says a number it
//     cannot show a card for.

const WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const word = (n: number) => WORD[n] ?? String(n);

export function inboxSentence(notices: MailNotice[], snap: MailSnapshot): string {
  if (notices.length === 0) return "";
  const n = (k: MailNotice["kind"]) => notices.filter((x) => x.kind === k).length;
  const deadline = n("deadline");
  const reply = n("reply");
  const promised = n("promised");
  const nudge = n("nudge");

  const bits: string[] = [];
  if (deadline > 0) bits.push(deadline === 1 ? "one has a deadline today" : `${word(deadline)} have deadlines today`);
  if (reply > 0) bits.push(reply === 1 ? "one needs an answer" : `${word(reply)} need answers`);
  if (promised > 0) bits.push(promised === 1 ? "one is something you promised" : `${word(promised)} are things you promised`);
  if (nudge > 0) {
    const worst = Math.max(...snap.waiting.map((w) => w.days), 0);
    bits.push(worst > 0 ? `someone has been waiting ${worst} days on you` : "someone owes you a reply");
  }
  if (bits.length === 0) return "";

  // The rest, only when there IS a rest. "and the rest is noise" over an
  // empty remainder would be the app performing calm rather than reporting it.
  const shown = new Set(notices.map((x) => x.threadId));
  const rest = snap.needsYou - snap.threads.filter((t) => shown.has(t.id)).length;
  const tail = rest > 0 ? `, and ${rest === 1 ? "one more" : word(rest) + " more"} that can wait` : "";

  // Bits are written for the MIDDLE of a sentence, so whichever one leads
  // gets its capital here rather than each bit guessing its own position.
  const head = bits[0]!.charAt(0).toUpperCase() + bits[0]!.slice(1);
  const mid = bits.slice(1, -1);
  const last = bits.length > 1 ? bits[bits.length - 1]! : "";
  const body = bits.length === 1 ? head : [head, ...mid].join(", ") + " and " + last;
  return capAfterNumber(body + tail);
}
