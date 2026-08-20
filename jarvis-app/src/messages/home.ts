import { byRank } from "./triage";
import { capAfterNumber, titleCase } from "../shared/casing";
import { dayPhrase } from "../money/bills";

// THE HOME-PAGE EMAIL SURFACE (Dave 2026-08-20: "give me ideas to make the
// email homepage feature actually useful or we can scratch it because right
// now it serves absolutely no purpose").
//
// He was right. "14 emails need you → Deal with it here" is a number and a
// link to somewhere else. It told him he was behind and then made him travel
// to find out what about. That is a guilt counter, not a feature.
//
// This replaces the count with the WORK. Every notice names one real thing
// and carries the one tap that ends it. Four different jobs, never the same
// job three times:
//
//   deadline  a sender named a date, and the date is now        → Add Task
//   reply     the single thread that most needs an answer       → Reply
//   promised  something YOU said you would do, in your own mail → Add Task
//   nudge     someone who owes YOU, and has for days            → Nudge
//
// Laws:
//   - Nothing here is invented. Deadlines come from what the sender wrote,
//     promises from the user's own sent words, waits from a thread whose
//     last message is the user's. An empty snapshot renders nothing.
//   - Today never waits on the network. This reads a snapshot the Email tab
//     wrote; a stale snapshot is dropped rather than shown as current.
//   - Two of the four finish WITHOUT leaving Today (they carry a task). The
//     other two open exactly the thread, never the inbox.

export interface MailThread {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  gist: string;
  by?: string;      // the answer-by the SENDER stated, never one we invented
  account?: string;
}
export interface MailWaiting { threadId: string; to: string; subject: string; days: number }
export interface MailPromise { threadId: string; text: string; due?: string }

export interface MailSnapshot {
  ts: number;
  needsYou: number;           // the true total, so the residual line is honest
  threads: MailThread[];      // needs-you threads, deadline order
  waiting: MailWaiting[];     // longest wait first
  promises: MailPromise[];
}

export type MailKind = "deadline" | "reply" | "promised" | "nudge";

export interface MailNotice {
  key: string;
  kind: MailKind;
  threadId: string;
  title: string;
  sub: string;
  action: string;
  tone: string;               // a cat-fg-* class
  // When present, the action finishes on Today: it writes this task and the
  // card clears. No navigation, no inbox, no second decision.
  task?: { text: string; due?: string };
}

const KEY = "jarvis.mail.home.v1";
// A snapshot older than this is history, not status. Today renders nothing
// rather than telling him about an inbox from last week.
export const SNAPSHOT_MAX_AGE_MS = 36 * 3600e3;

export const EMPTY: MailSnapshot = { ts: 0, needsYou: 0, threads: [], waiting: [], promises: [] };

export function saveMailSnapshot(snap: MailSnapshot, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, JSON.stringify(snap)); } catch { /* private mode */ }
}

export function loadMailSnapshot(
  now: number = Date.now(),
  storage: Pick<Storage, "getItem"> = localStorage,
): MailSnapshot {
  try {
    const raw = storage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<MailSnapshot>) : null;
    if (!p || typeof p.ts !== "number") return EMPTY;
    if (now - p.ts > SNAPSHOT_MAX_AGE_MS) return EMPTY;
    return {
      ts: p.ts,
      needsYou: typeof p.needsYou === "number" ? p.needsYou : 0,
      threads: Array.isArray(p.threads) ? p.threads : [],
      waiting: Array.isArray(p.waiting) ? p.waiting : [],
      promises: Array.isArray(p.promises) ? p.promises : [],
    };
  } catch {
    return EMPTY;
  }
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The date the SENDER named, resolved. Anything we cannot read stays absent:
// a made-up due date is the exact failure this whole app is built against.
export function dueFromBy(by: string | undefined, todayISO: string, now = new Date()): string | undefined {
  if (!by || !by.trim()) return undefined;
  const rank = byRank(by, now);
  if (rank > 30) return undefined;
  return addDays(todayISO, rank);
}

// How the deadline reads back. "Today" and "Tomorrow" are the only two words
// worth spending; past that the sender's own phrase is clearer than ours.
export function byLabel(by: string | undefined, now = new Date()): string {
  const rank = byRank(by, now);
  if (rank === 0) return "Today";
  if (rank === 1) return "Tomorrow";
  return titleCase((by ?? "").trim());
}

function deadlineNotice(t: MailThread, todayISO: string, now: Date): MailNotice | null {
  const due = dueFromBy(t.by, todayISO, now);
  if (!due || byRank(t.by, now) > 1) return null; // only when the date is NOW
  return {
    key: "deadline:" + t.id,
    kind: "deadline",
    threadId: t.id,
    title: titleCase(t.subject),
    sub: capAfterNumber(`From ${t.from} · Due ${byLabel(t.by, now).toLowerCase()}`),
    action: "Add Task",
    tone: "cat-fg-red",
    task: { text: titleCase(t.subject), due },
  };
}

function replyNotice(t: MailThread): MailNotice {
  return {
    key: "reply:" + t.id,
    kind: "reply",
    threadId: t.id,
    title: t.from,
    sub: t.gist || t.subject,
    action: "Reply",
    tone: "cat-fg-blue",
  };
}

function promiseNotice(p: MailPromise, todayISO: string): MailNotice {
  return {
    key: "promised:" + p.threadId,
    kind: "promised",
    threadId: p.threadId,
    title: titleCase(p.text),
    sub: p.due ? "You said you would, by " + dayPhrase(p.due, todayISO) : "You said you would",
    action: "Add Task",
    tone: "cat-fg-yellow",
    task: { text: titleCase(p.text), due: p.due },
  };
}

function nudgeNotice(w: MailWaiting): MailNotice {
  return {
    key: "nudge:" + w.threadId,
    kind: "nudge",
    threadId: w.threadId,
    title: w.to + " Hasn't Replied",
    sub: capAfterNumber(`${w.subject} · ${w.days} ${w.days === 1 ? "day" : "days"}`),
    action: "Nudge",
    tone: "cat-fg-purple",
  };
}

// One of each job first, best of its kind, THEN fill by priority. Three
// versions of "answer this email" is the pile with a new haircut; a deadline,
// a person waiting on him, and a promise he made are three different moves.
export function mailNotices(
  snap: MailSnapshot,
  todayISO: string,
  now = new Date(),
  max = 3,
  hidden: string[] = [],
): MailNotice[] {
  const skip = new Set(hidden);
  const threads = [...snap.threads].sort((a, b) => byRank(a.by, now) - byRank(b.by, now));

  const deadlines = threads.map((t) => deadlineNotice(t, todayISO, now)).filter((n): n is MailNotice => n !== null);
  const deadlineIds = new Set(deadlines.map((d) => d.threadId));
  // A thread already surfaced as a deadline is not also surfaced as a reply.
  const replies = threads.filter((t) => !deadlineIds.has(t.id)).map(replyNotice);
  const promises = [...snap.promises]
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    .map((p) => promiseNotice(p, todayISO));
  const nudges = [...snap.waiting].sort((a, b) => b.days - a.days).map(nudgeNotice);

  const lanes = [deadlines, replies, promises, nudges].map((l) => l.filter((n) => !skip.has(n.key)));
  const out: MailNotice[] = [];
  for (let round = 0; out.length < max; round++) {
    let took = false;
    for (const lane of lanes) {
      const pick = lane[round];
      if (!pick) continue;
      out.push(pick);
      took = true;
      if (out.length >= max) break;
    }
    if (!took) break;
  }
  return out;
}

// The count survives, demoted to a footnote. It is the truth (he has an
// inbox) without being the headline (he is behind). Silent when the notices
// above already cover everything that needs him.
export function residualLine(snap: MailSnapshot, shownThreadIds: string[]): string {
  const covered = new Set(shownThreadIds);
  const left = snap.needsYou - snap.threads.filter((t) => covered.has(t.id)).length;
  if (left <= 0) return "";
  return titleCase(`${left} more ${left === 1 ? "email" : "emails"} in your inbox`);
}

// Dismissals last the DAY, not forever. A swiped notice is "not now", and
// tomorrow is a new now: the email is still sitting there, so hiding it
// permanently would be the app lying to him on his behalf.
const DKEY = "jarvis.mail.home.dismissed.v1";

export function loadDismissed(
  todayISO: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): string[] {
  try {
    const p = JSON.parse(storage.getItem(DKEY) || "null") as { day?: string; keys?: string[] } | null;
    if (!p || p.day !== todayISO || !Array.isArray(p.keys)) return [];
    return p.keys.filter((k): k is string => typeof k === "string");
  } catch {
    return [];
  }
}

export function dismissNotice(
  key: string,
  todayISO: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): string[] {
  const keys = [...new Set([...loadDismissed(todayISO, storage), key])];
  try { storage.setItem(DKEY, JSON.stringify({ day: todayISO, keys })); } catch { /* private mode */ }
  return keys;
}
