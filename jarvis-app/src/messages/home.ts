import { byRank } from "./triage";
import { capAfterNumber, titleCase } from "../shared/casing";
import { decide, draftableOf } from "./mailAction";
import { dayPhrase } from "../money/bills";
import { fmtTime } from "../schedule/calendar";

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
  // U1/U2 (2026-08-20): enough to answer WITHOUT opening the thread. The
  // snippet is what the reply is drafted from; the replies are the quick
  // answers the Email tab already generated for this thread, reused rather
  // than regenerated. Absent means the card falls back to opening the thread,
  // which is exactly what it did before.
  snippet?: string;
  lastMsgId?: string;
  replies?: string[];
}
export interface MailWaiting { threadId: string; to: string; subject: string; days: number }
export interface MailPromise { threadId: string; text: string; due?: string }
// N1 (2026-08-20): times a sender OFFERED, already checked against the real
// calendar by the Email tab. Only threads where at least one option is open
// travel here; "you're busy for all of them" is a card the tab shows, not a
// home-page interruption.
export interface MailMeeting { threadId: string; from: string; label: string; date: string; start: string; end: string; line: string }
// N3: a chase he set at send time that has come due.
export interface MailChase { threadId: string; to: string; subject: string }
// N10: a draft he started and never sent.
export interface MailDraftRow { id: string; threadId: string; to: string; subject: string; line: string }

export interface MailSnapshot {
  ts: number;
  needsYou: number;           // the true total, so the residual line is honest
  threads: MailThread[];      // needs-you threads, deadline order
  waiting: MailWaiting[];     // longest wait first
  promises: MailPromise[];
  meetings?: MailMeeting[];
  chases?: MailChase[];
  drafts?: MailDraftRow[];
}

export type MailKind = "deadline" | "reply" | "promised" | "nudge" | "meeting" | "chase" | "draft";

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

export const EMPTY: MailSnapshot = { ts: 0, needsYou: 0, threads: [], waiting: [], promises: [], meetings: [], chases: [], drafts: [] };

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
      meetings: Array.isArray(p.meetings) ? p.meetings : [],
      chases: Array.isArray(p.chases) ? p.chases : [],
      drafts: Array.isArray(p.drafts) ? p.drafts : [],
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

// N1: the sender offered times and at least one is open. One tap takes it,
// which books it, replies, and blocks the slot: three decisions become none.
function meetingNotice(m: MailMeeting): MailNotice {
  return {
    key: "meeting:" + m.threadId,
    kind: "meeting",
    threadId: m.threadId,
    title: m.from + " Wants a Time",
    sub: m.line,
    // THE BUTTON SAYS A TIME, NOT A SENTENCE (2026-08-24, Dave's screenshot).
    //
    // This was `"Take " + m.label`, and m.label is the SENDER'S OWN PHRASE,
    // kept up to 60 characters by meetingTimes.ts. One real inbox produced
    // "Take 1:00 pm (ET) on Monday, August 24th": a 40-character label in a
    // flex-shrink:0 pill, which crushed the title column to one letter per
    // line and rendered the card as a vertical stack of single characters.
    //
    // The meeting already carries `start` as a real field, so the button
    // states the time itself and stays short whatever the sender wrote. The
    // sender's phrasing is not lost: `m.line` carries it into the sub.
    action: "Take " + fmtTime(m.start).time + " " + fmtTime(m.start).ap,
    tone: "cat-fg-sky",
  };
}

// N3: a chase HE set, come due, and still unanswered.
function chaseNotice(c: MailChase): MailNotice {
  return {
    key: "chase:" + c.threadId,
    kind: "chase",
    threadId: c.threadId,
    title: "Chase " + c.to,
    sub: capAfterNumber(c.subject + " · You asked me to"),
    // A chase starts gentle whatever the clock says (N13), so the wait is 0
    // and only the ask moves the label. Unlike a derived nudge, a chase he
    // set himself never disappears: with nothing draftable to derive the old
    // label stands, and it still drafts.
    action: draftableOf(decide(c.subject ?? "", "", 0))?.label ?? "Nudge",
    tone: "cat-fg-orange",
  };
}

// N10: a draft sitting for days is not a draft, it is a decision he is
// avoiding wearing the costume of work in progress.
function draftNotice(d: MailDraftRow): MailNotice {
  return {
    key: "draft:" + d.id,
    kind: "draft",
    threadId: d.threadId || d.id,
    title: d.subject.trim() ? "Unsent: " + d.subject.trim() : "An Unsent Draft",
    sub: d.line,
    action: "Finish It",
    tone: "cat-fg-magenta",
  };
}

// THE ASK DECIDES THE ACTION, ON THIS PAGE TOO (2026-08-21).
//
// The Email tab stopped printing one universal button; the home page kept
// printing "Nudge" on every waiting thread, which is the same bug on the
// screen Dave sees first. hasPhone stays false on purpose: this card drafts,
// it does not dial, and a label may only promise what the handler performs.
//
// null when nothing here can be said in an email. A receipt owes nothing, so
// it leaves the home page exactly as it leaves Waiting On.
function nudgeNotice(w: MailWaiting): MailNotice | null {
  const act = draftableOf(decide(w.subject ?? "", "", w.days));
  if (!act) return null;
  return {
    key: "nudge:" + w.threadId,
    kind: "nudge",
    threadId: w.threadId,
    title: w.to + " Hasn't Replied",
    sub: capAfterNumber(`${w.subject} · ${w.days} ${w.days === 1 ? "day" : "days"}`),
    action: act.label,
    // mail-glyph opts this one into the light theme's brand-red envelope
    // (components.css). The marker is explicit so the rule cannot catch
    // every purple glyph in the app, which is exactly what it used to do.
    tone: "cat-fg-purple mail-glyph",
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
  const nudges = [...snap.waiting].sort((a, b) => b.days - a.days)
    .map(nudgeNotice).filter((n): n is MailNotice => n !== null);
  const meetings = (snap.meetings ?? []).map(meetingNotice);
  const chases = (snap.chases ?? []).map(chaseNotice);
  const drafts = (snap.drafts ?? []).map(draftNotice);

  // Lane order IS priority order. A meeting he can book in one tap and a
  // deadline someone named beat everything: both are other people's clocks.
  // Drafts go last, because an unsent draft is the only thing on this list
  // that is nobody's problem but his.
  const lanes = [meetings, deadlines, replies, chases, promises, nudges, drafts]
    .map((l) => l.filter((n) => !skip.has(n.key)));
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
