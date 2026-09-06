import { decide, draftableOf, type Decision } from "./mailAction";
import { titleCase, capAfterNumber } from "../shared/casing";
import { dayPhrase } from "../money/bills";

// THE LEDGER (UP-MIND-11, Email E5 and 5.2).
//
// "What did I promise, to whom, by when" is the question no mail client
// answers. Every half of the answer already existed and none of it was ever
// put on one screen: tasks born from a thread, promises swept out of sent
// mail, threads where the last word was the user's, and chases they set
// themselves. A business owner who forgets a promised quote loses the job,
// and the app knew about the quote the whole time.
//
// THIS IS A VIEW, and the word is load-bearing. There is no ledger store, no
// ledger row, no ledger state: finishing a task anywhere clears it here
// because the task IS the row, read fresh. A second store would be a second
// truth, and the first thing it would do is disagree.
//
// It also does not decide what to do about anything. Every prepared action
// comes from decide() in mailAction.ts, the app's one action-decider, so the
// verb on a ledger row is the same verb the same situation gets in Waiting
// On, on Today, and in the deck.

export type LedgerSide = "you_owe" | "they_owe";

export interface LedgerRow {
  key: string;
  side: LedgerSide;
  /** The person, when the app knows who: a display name, never invented. */
  who: string;
  /** What is outstanding, in the words it was recorded in. */
  what: string;
  /** "Since Tuesday" / "9 days". The row's own age, never a score. */
  since: string;
  /** Sorts the row: the day it is due, or the day it started. */
  sortKey: string;
  /** Past its date, either side. */
  late: boolean;
  /** The thread it came from, when there is one. */
  threadId?: string;
  /** The task it came from, when there is one. */
  taskId?: string;
  /** Who it is about (UP-MIND-10), when the counterpart is in Contacts. */
  personId?: string;
  /** The prepared action and its alternates, from the one decider. */
  decision?: Decision;
  /** The label the row's single button wears. */
  action: string;
}

export interface LedgerInput {
  today: string;
  /** Open tasks. Only ones that came off a thread or a swept promise reach
   *  the ledger: a to-do the user typed themselves is not a promise to
   *  anyone, and filing it here would turn the ledger into the task list. */
  tasks: { id: string; text: string; done?: boolean; due?: string | null; fromThread?: string; personId?: string; sourceKind?: string }[];
  /** Threads where the last word was the user's and nobody has answered. */
  waiting: { threadId: string; to: string; subject: string; days: number; personId?: string }[];
  /** Chases the user set themselves, already filtered to the ones due. */
  chases: { threadId: string; to: string; subject: string; personId?: string }[];
  /** Promises swept out of sent mail that have not become tasks yet. */
  promises: { threadId: string; text: string; due?: string; personId?: string }[];
}

export interface Ledger {
  youOwe: LedgerRow[];
  theyOweYou: LedgerRow[];
  late: LedgerRow[];
  /** Every row, once, whichever section it is showing in. */
  total: number;
}

// How a wait reads back. Days for anything short, weeks past a fortnight:
// "31 days" is a number to do arithmetic on, "4 weeks" is a fact.
export function sinceLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < 14) return days + " days";
  const w = Math.round(days / 7);
  return w + " weeks";
}

export function buildLedger(input: LedgerInput): Ledger {
  const { today } = input;
  const rows: LedgerRow[] = [];

  // YOU OWE. The tasks that came out of mail, plus the promises still
  // waiting to become tasks. Both are the user's own words, either their
  // sentence or the subject of the thread they took on.
  for (const t of input.tasks) {
    if (t.done) continue;
    if (!t.fromThread && t.sourceKind !== "email") continue;
    const due = t.due ?? "";
    rows.push({
      key: "task:" + t.id,
      side: "you_owe",
      who: "",
      what: t.text,
      since: due ? capAfterNumber(titleCase("Due " + dayPhrase(due, today))) : "No date",
      sortKey: due || "9999-12-31",
      late: !!due && due < today,
      ...(t.fromThread ? { threadId: t.fromThread } : {}),
      taskId: t.id,
      ...(t.personId ? { personId: t.personId } : {}),
      action: "Open",
    });
  }
  for (const p of input.promises) {
    rows.push({
      key: "promise:" + p.threadId,
      side: "you_owe",
      who: "",
      what: titleCase(p.text),
      since: p.due ? capAfterNumber(titleCase("Due " + dayPhrase(p.due, today))) : "You said you would",
      sortKey: p.due || "9999-12-31",
      late: !!p.due && p.due < today,
      threadId: p.threadId,
      ...(p.personId ? { personId: p.personId } : {}),
      action: "Add Task",
    });
  }

  // THEY OWE YOU. A thread whose last word was the user's, and a chase they
  // set. The verb on each row comes from decide(), never from here.
  for (const w of input.waiting) {
    const d = decide(w.subject ?? "", "", w.days);
    // A receipt owes nothing, and decide() is what knows that. A row with no
    // draftable move is not a debt; it drops out here exactly as it drops out
    // of Waiting On and off the home page.
    const act = draftableOf(d);
    if (!act) continue;
    rows.push({
      key: "waiting:" + w.threadId,
      side: "they_owe",
      who: w.to,
      what: w.subject,
      since: sinceLabel(w.days),
      sortKey: String(10000 - Math.min(w.days, 9999)).padStart(5, "0"),
      late: w.days >= 7,
      threadId: w.threadId,
      ...(w.personId ? { personId: w.personId } : {}),
      decision: d,
      action: act.label,
    });
  }
  for (const c of input.chases) {
    // A chase the user set themselves. Its button OPENS the thread rather
    // than drafting: the drafting path needs the recipient's address, which a
    // waiting row carries and a chase does not, and a label may only promise
    // what the handler performs. When the same thread is also in Waiting On
    // (the usual case) the waiting row wins the dedupe below and the drafted
    // move comes back with it.
    rows.push({
      key: "chase:" + c.threadId,
      side: "they_owe",
      who: c.to,
      what: c.subject,
      since: "You asked me to",
      sortKey: "00000",
      late: false,
      threadId: c.threadId,
      ...(c.personId ? { personId: c.personId } : {}),
      action: "Open",
    });
  }

  // A thread can produce both a task and a waiting row. It is one debt, so
  // it gets one line, and the side that names an obligation of the user's
  // wins: what they owe is the half only they can clear.
  const seen = new Set<string>();
  const deduped: LedgerRow[] = [];
  for (const r of [...rows.filter((x) => x.side === "you_owe"), ...rows.filter((x) => x.side === "they_owe")]) {
    const sig = r.threadId ? "t:" + r.threadId : r.key;
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push(r);
  }

  const bySort = (a: LedgerRow, b: LedgerRow) => a.sortKey.localeCompare(b.sortKey);
  // LATE IS A LENS, NOT A THIRD PILE. A late row appears in Late AND in the
  // side it belongs to, because hiding it from its own side would make the
  // two sections lie about what is open with that person.
  return {
    youOwe: deduped.filter((r) => r.side === "you_owe").sort(bySort),
    theyOweYou: deduped.filter((r) => r.side === "they_owe").sort(bySort),
    // Late mixes the two sides, whose sort keys are not the same kind of
    // thing (a due date and a wait length), so it groups by side first:
    // what the user owes, oldest first, then what is owed to them.
    late: deduped.filter((r) => r.late).sort((a, b) => (a.side === b.side ? bySort(a, b) : a.side === "you_owe" ? -1 : 1)),
    total: deduped.length,
  };
}

// The floor line, per the law that every list says when it is showing
// everything. Never a score, never a streak, and calm when there is nothing:
// an empty ledger is the good outcome, not an empty state to apologise for.
export function ledgerFloor(l: Ledger): string {
  if (l.total === 0) return "Nothing is open";
  return capAfterNumber(l.total === 1 ? "That's the one that's open" : "That's every one that's open");
}
