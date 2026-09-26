// THE FACTS LINE, IN MAIL (EM5, Email Build Master section 3, Dave's picks
// 2026-09-12). Non-interactive per-row data on these screens (what a thread
// is waiting for, the sender's own words behind a claim, whether a rule is
// on) renders as Astra's .facts: short fragments, a
// middle dot the CSS draws between them, at most one semantic colour per
// line (K.3). Filled chips and capsules are for things you tap; a fact is
// read.
//
// This is the one place messages/ builds a facts line, so K.3 is enforced
// HERE rather than trusted at every call site: the first toned fact keeps
// its tone and any tone after it is dropped. laws/email.test.ts pins that,
// and a unit test proves it bites.

import type { ReactNode } from "react";
import type { AskKind } from "./mailAction";
import type { Evidence } from "./evidence";
import { daysBetween } from "../upnext/upnext";

// The Colour Key's own variants (§AM): due, done, late, an estimate the app
// worked out (.fact.est, sky), and a neutral date (.fact.date, small caps).
// The retired .fact.sky and .fact.purp have no rule and are not here.
// `date` is CAPS, not a colour, so it never counts toward K.3's one colour:
// a line may carry a red and a date together.
export type FactTone = "warn" | "good" | "red" | "est" | "date";
export interface Fact { text: string; tone?: FactTone }

/** One .facts line. Nullish or false entries are skipped so a caller can
 *  write `[a, cond && b]` without a filter of its own. */
export function Facts({ facts, className = "" }: { facts: (Fact | null | undefined | false)[]; className?: string }): ReactNode {
  const list = facts.filter((f): f is Fact => !!f && f.text.trim().length > 0);
  if (list.length === 0) return null;
  let toned = false;
  return (
    <div className={"facts" + (className ? " " + className : "")}>
      {list.map((f, i) => {
        // A neutral date is caps, not a colour: it rides past the counter.
        if (f.tone === "date") return <span key={i} className="fact date">{f.text}</span>;
        // K.3: one coloured fact per line. The first keeps its colour.
        const tone = f.tone && !toned ? f.tone : undefined;
        if (tone) toned = true;
        return <span key={i} className={"fact" + (tone ? " " + tone : "")}>{f.text}</span>;
      })}
    </div>
  );
}

/** A date's tone follows the reminder and project window (§AM, R8): a day
 *  behind us is late (red), today or tomorrow is due (amber), and anything
 *  later is a neutral date (small caps). Both are YYYY-MM-DD. */
export function dayTone(iso: string, today: string): "red" | "warn" | "date" {
  const gap = daysBetween(today, iso);
  return gap < 0 ? "red" : gap <= 1 ? "warn" : "date";
}

/** E-35: what a Waiting On thread is waiting FOR, from askKindOf. Null for
 *  a thread that is owed nothing, which belongs on the Nothing Owed list
 *  and never wears this fact. */
export function waitingFor(kind: AskKind): Fact | null {
  const what =
    kind === "money_in" ? "money"
    : kind === "goods" ? "the order"
    : kind === "they_asked" ? "a call"
    : kind === "answer" ? "an answer"
    : null;
  return what ? { text: "Waiting for: " + what } : null;
}

/** UP-MIND-12 carried over: the sender's own words, verbatim, as a quiet
 *  fact. Never toned, because the words are the evidence and a colour would
 *  be a claim about them. */
export function evidenceFact(ev: Evidence | undefined): Fact | null {
  const span = ev?.span.trim();
  return span ? { text: "“" + span + "”" } : null;
}

/** E-24 (ahead of Push E): a standing rule's switch. On is the one fact,
 *  toned, because it is the one that changes what the rule does. The row
 *  already spends its one grey on the bucket beside the name (§AM R1), so
 *  nothing else here is grey: the account is the chip row's to show (it
 *  appears when there is a choice), and Off is already said by the dimmed
 *  name and the Turn On capsule, so an off rule has no line at all. */
export function ruleStateFact(on: boolean): Fact | null {
  return on ? { text: "On", tone: "good" } : null;
}
