// THE FACTS LINE, IN MAIL (EM5, Email Build Master section 3, Dave's picks
// 2026-09-12). Non-interactive per-row data on these screens (what a thread
// is waiting for, the sender's own words behind a claim, a rule's account
// and whether it is on) renders as Astra's .facts: short fragments, a
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

export type FactTone = "warn" | "good" | "sky" | "purp" | "red";
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
        // K.3: one coloured fact per line. The first keeps its colour.
        const tone = f.tone && !toned ? f.tone : undefined;
        if (tone) toned = true;
        return <span key={i} className={"fact" + (tone ? " " + tone : "")}>{f.text}</span>;
      })}
    </div>
  );
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

/** E-24 (ahead of Push E): a standing rule's scope and its switch. The
 *  account is a label and stays quiet; On is the one fact that carries a
 *  tone, because it is the one that changes what the rule does. */
export function ruleAccountFact(account: string | undefined, on: boolean): Fact[] {
  return [
    { text: "Account: " + (account || "All") },
    on ? { text: "On", tone: "good" } : { text: "Off" },
  ];
}
