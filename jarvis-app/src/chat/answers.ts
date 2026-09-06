// Chat's deterministic Q&A layer (addendum item 23). Runs BEFORE any AI
// call (cost guard). Answers come FROM RECORDS: numbers are computed here,
// refs point at the rows used, and an unknown question returns null so the
// grounded AI path (or an honest refusal offline) can take it. Never a
// guess: a fuzzy title match below the floor is a null, not a shrug.

import type { ChatProvenance } from "./types";
import { capAfterNumber } from "../shared/casing";
import { shortDate } from "../shared/dateFormat";
import { namePatterns, openWith } from "../people/mentions";
import { birthdayLabel } from "../people/birthdays";
import { agoLabel } from "../people/lastContact";

export interface AnswerSnapshot {
  today: string;
  events: { id: string; title: string; date: string; start: string; location?: string }[];
  // UP-MIND-10 (2026-09-05): personId, when the task was filed off an
  // email with someone in Contacts.
  tasks: { id: string; text: string; due?: string | null; done: boolean; personId?: string }[];
  // Money's derived left-to-spend line, already computed by the money layer;
  // null when money is not set up. Chat never does money math itself.
  leftToSpend: string | null;
  nowHHMM: string;
  // S6-Q42 (2026-09-05): "Chat cannot see your email." The same needs-you
  // snapshot the Email tab and Today already read (messages/home.ts's
  // MailSnapshot), reused as-is -- Chat never fetches mail itself, only the
  // cache. Null means no usable snapshot (no Gmail connection, or one too
  // stale to trust): the question falls through to the AI path or the
  // offline refusal, the same discipline leftToSpend already follows. A
  // total of zero is a real, current answer -- genuinely caught up.
  //
  // SHELL-F-08 (2026-09-05): the TOTAL travels with the list, because the
  // list is a preview. The snapshot caps `threads` at 6 on purpose (it is
  // there for the refs), and counting it answered "6 need you in email" while
  // Today and the Email tab both said 9. A shape where the count and the
  // preview are one array is a shape that makes that mistake again.
  mailNeedsYou: { total: number; threads: { id: string; subject: string }[] } | null;
  // UP-MIND-03 (2026-09-05): people as a first-class subject. "What's open
  // with Marco" was three tabs of hunting; the matchers the person card
  // already uses (people/mentions.ts) answer it from records, with no AI
  // call and nothing invented.
  people: { id: string; name: string; email?: string; birthday?: string; relationship?: string }[];
  // The threads where the last word is the user's and nobody has answered
  // (messages/home.ts's MailSnapshot.waiting), keyed by who it went to.
  waiting: { threadId: string; to: string; subject: string; days: number }[];
  // Resolves the last message time with an address, or null when there is
  // none. Absent means no Google session, which is a different answer from
  // "you have never talked": the reply says which.
  lastContact?: (email: string) => Promise<number | null>;
  now?: number;
}

export interface ChatAnswer {
  text: string;
  provenance: ChatProvenance;
  // UP-MIND-03: a question that named more than one person it knows. The
  // bounded chooser the command path already renders, reused for Q&A, so
  // ambiguity is a question back rather than a confident wrong answer.
  choose?: { id: string; text: string }[];
}

const fmt12 = (hhmm: string): string => {
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(3), 10);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
};

// Dot-break casing (V3.3): a segment after the middle dot starts capital.
// dayWord stays lowercase because it also rides mid-segment ("Due today");
// the caller capitalizes only when the word LEADS its segment.
const capLead = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const dayWord = (iso: string, today: string): string => {
  if (iso === today) return "today";
  const diff = Math.round((Date.parse(iso + "T12:00:00") - Date.parse(today + "T12:00:00")) / 86400000);
  if (diff === 1) return "tomorrow";
  const d = new Date(iso + "T12:00:00");
  if (diff > 1 && diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return shortDate(iso);
};

// Word-overlap title match with a floor: every query word must appear.
function findByTitle<T>(items: T[], titleOf: (t: T) => string, q: string): T[] {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  return items.filter((it) => {
    const t = titleOf(it).toLowerCase();
    return words.every((w) => t.includes(w));
  });
}


// Steps a local day with setDate, never with a UTC serialiser: the house
// timezone rule (schedule/calendar.ts owns the general helpers; this file
// needs exactly one day of it and importing the schedule layer into Chat's
// pure answer module would be the bigger change).
function addOneDay(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- FOLLOW-UPS (UP-MIND-04) ---

/** The last thing this conversation answered: the question as it was finally
 *  understood, and the records the answer cited. */
export interface Prior {
  question: string;
  refs?: { kind: string; id: string; label: string }[];
}

// "And tomorrow?" after "what's on today" is one question, asked in two
// turns. This rewrites the second turn into a whole question so every shape
// below stays stateless and testable: nothing here answers anything, it only
// says what was meant. A rewrite it cannot make honestly returns null, and
// the turn goes on to the AI path with the conversation attached.
export function rewriteFollowUp(raw: string, prior: Prior | null): string | null {
  if (!prior) return null;
  const t = raw.trim().toLowerCase().replace(/[?.!]+$/, "");
  if (!t) return null;
  // "and tomorrow", "what about today", "how about tomorrow"
  const day = t.match(/^(?:and|what about|how about|ok(?:ay)? and)\s+(today|tomorrow)$/);
  if (day) return `what's on ${day[1]}`;
  // "and <something else>" against the shape just asked: the verb is carried
  // over, the subject is replaced. Only for the two shapes that HAVE a
  // subject, because carrying "and the standup" onto "how much can I spend"
  // would be nonsense.
  const other = t.match(/^(?:and|what about|how about)\s+(.+)$/);
  if (other) {
    const verb = prior.question.trim().toLowerCase().match(/^(when(?:'| i)?s|when is|where(?:'| i)?s|where is)\b/);
    if (verb) return `${verb[1]} ${other[1]}`;
    return null;
  }
  // A pronoun standing in for the record the last answer cited. Without a
  // ref there is nothing to stand in for, so this stays null rather than
  // guessing which "it" was meant.
  const first = prior.refs?.[0];
  if (!first) return null;
  if (!/\b(it|that|this one|the next one|him|her|them)\b/.test(t)) return null;
  const filled = t.replace(/\b(it|that|this one|the next one|him|her|them)\b/, first.label);
  return filled === t ? null : filled;
}

// --- PEOPLE (UP-MIND-03) ---

type SnapPerson = AnswerSnapshot["people"][number];

// Which of the user's people this text is about. The same narrow matcher the
// person card uses: the full name always counts, a first name only when it
// cannot be mistaken for an ordinary word. A wrong link here attaches
// someone else's work to a name, which is worse than no answer.
function peopleNamed(query: string, people: SnapPerson[]): SnapPerson[] {
  const q = query.trim();
  if (q.length < 2) return [];
  return people.filter((p) => namePatterns(p.name).some((re) => re.test(q)));
}

const personRef = (p: SnapPerson) => ({ kind: "person", id: p.id, label: p.name });

// Two or more people answer to the name. The A23 rule is that ambiguity
// shows the options rather than picking one, so this is the same bounded
// chooser the command path renders, capped at four.
function chooser(matches: SnapPerson[]): ChatAnswer {
  return {
    text: "Which one?",
    provenance: { kind: "records", refs: matches.slice(0, 4).map(personRef) },
    choose: matches.slice(0, 4).map((p) => ({ id: p.id, text: p.name })),
  };
}

async function lastTalked(p: SnapPerson, snap: AnswerSnapshot): Promise<ChatAnswer> {
  const refs = [personRef(p)];
  if (!p.email) return { text: `${p.name} has no email on file`, provenance: { kind: "records", refs } };
  if (!snap.lastContact) return { text: `${p.name} · Email isn't connected`, provenance: { kind: "records", refs } };
  const ms = await snap.lastContact(p.email);
  if (ms === null) return { text: `Nothing in your mail with ${p.name}`, provenance: { kind: "records", refs } };
  return { text: `${p.name} · Last talked ${agoLabel(ms, snap.now ?? Date.now())}`, provenance: { kind: "records", refs } };
}

function openWithPerson(p: SnapPerson, snap: AnswerSnapshot): ChatAnswer {
  const items = openWith(
    { name: p.name, id: p.id },
    snap.tasks.map((t) => ({ id: t.id, text: t.text, done: t.done, due: t.due, ...(t.personId ? { personId: t.personId } : {}) })),
    snap.events.map((e) => ({ id: e.id, title: e.title, date: e.date, start: e.start, location: e.location })),
    snap.today,
  );
  const waits = snap.waiting.filter((w) => namePatterns(p.name).some((re) => re.test(w.to)));
  const refs = [
    personRef(p),
    ...items.map((i) => ({ kind: i.kind, id: i.id, label: i.title })),
    ...waits.map((w) => ({ kind: "thread", id: w.threadId, label: w.subject })),
  ];
  if (items.length === 0 && waits.length === 0) {
    return { text: `Nothing open with ${p.name}`, provenance: { kind: "records", refs: [personRef(p)] } };
  }
  const parts: string[] = [];
  if (items.length) parts.push(`${items.length} open`);
  if (waits.length) parts.push(`${waits.length} waiting on ${p.name}`);
  return { text: capAfterNumber(parts.join(" · ")), provenance: { kind: "records", refs } };
}

function owedTo(p: SnapPerson, snap: AnswerSnapshot): ChatAnswer {
  const pats = namePatterns(p.name);
  const ts = snap.tasks.filter((t) => !t.done && pats.some((re) => re.test(t.text)));
  const refs = [personRef(p), ...ts.map((t) => ({ kind: "task", id: t.id, label: t.text }))];
  if (ts.length === 0) return { text: `Nothing open naming ${p.name}`, provenance: { kind: "records", refs: [personRef(p)] } };
  // A fact, not a verdict: these are the open tasks that NAME them. JARVIS
  // does not decide what is owed to whom.
  return {
    text: capAfterNumber(`${ts.length} open ${ts.length === 1 ? "task" : "tasks"} naming ${p.name}`),
    provenance: { kind: "records", refs },
  };
}

function birthdayOf(p: SnapPerson): ChatAnswer {
  const label = birthdayLabel(p.birthday);
  const refs = [personRef(p)];
  if (!label) return { text: `${p.name} has no birthday saved`, provenance: { kind: "records", refs } };
  return { text: `${p.name} · ${label}`, provenance: { kind: "records", refs } };
}

// The four shapes, in one place. Returns null when the question is not about
// a person at all, or names nobody the app knows: the AI path takes it from
// there, exactly as it did before.
async function answerAboutPerson(q: string, snap: AnswerSnapshot, pinned?: SnapPerson): Promise<ChatAnswer | null> {
  const shapes: { re: RegExp; group: number; run: (p: SnapPerson) => Promise<ChatAnswer> | ChatAnswer }[] = [
    { re: /^when did i (?:last )?(?:talk|speak|email|write) (?:to|with) (.+)$/, group: 1, run: (p) => lastTalked(p, snap) },
    { re: /^when did i last (?:hear from|contact) (.+)$/, group: 1, run: (p) => lastTalked(p, snap) },
    { re: /^what(?:'| i)?s open with (.+)$/, group: 1, run: (p) => openWithPerson(p, snap) },
    { re: /^what do i owe (.+)$/, group: 1, run: (p) => owedTo(p, snap) },
    { re: /^when(?: i)?s (.+?)(?:'s)? birthday$/, group: 1, run: (p) => birthdayOf(p) },
    { re: /^when is (.+?)(?:'s)? birthday$/, group: 1, run: (p) => birthdayOf(p) },
  ];
  for (const sh of shapes) {
    const m = q.match(sh.re);
    if (!m) continue;
    const query = (m[sh.group] ?? "").trim();
    if (pinned) return sh.run(pinned);
    const matches = peopleNamed(query, snap.people);
    if (matches.length === 0) return null;
    if (matches.length > 1) return chooser(matches);
    return sh.run(matches[0]!);
  }
  return null;
}

// UP-MIND-03 (2026-09-05): async, because the last-talked answer reads a
// cached Gmail lookup. Every other shape still resolves without awaiting
// anything, and the AI path below it is unchanged.
//
// `pinned` is the person the user picked out of the chooser, so a repeat of
// the same question answers rather than asking again.
export async function answerQuestion(
  raw: string,
  snap: AnswerSnapshot,
  pinned?: { id: string },
): Promise<ChatAnswer | null> {
  const q = raw.trim().toLowerCase().replace(/[?.!]+$/, "");
  const who = pinned ? snap.people.find((p) => p.id === pinned.id) : undefined;
  const aboutPerson = await answerAboutPerson(q, snap, who);
  if (aboutPerson) return aboutPerson;

  // "what's today" / "what does today look like"
  if (/^(what('| i)?s (on )?today|what does today look like|today)$/.test(q)) {
    const evs = snap.events.filter((e) => e.date === snap.today);
    const due = snap.tasks.filter((t) => !t.done && t.due === snap.today);
    return {
      text: capAfterNumber(`${evs.length} ${evs.length === 1 ? "event" : "events"} · ${due.length} ${due.length === 1 ? "task" : "tasks"} due`),
      provenance: { kind: "records" },
    };
  }

  // UP-MIND-04 (2026-09-05): "and tomorrow?" is how people actually talk, and
  // it rewrites to this. There was no tomorrow shape at all before, so the
  // follow-up had nothing to resolve into.
  if (/^(what('| i)?s (on )?tomorrow|what does tomorrow look like|tomorrow)$/.test(q)) {
    const tmr = addOneDay(snap.today);
    const evs = snap.events.filter((e) => e.date === tmr);
    const due = snap.tasks.filter((t) => !t.done && t.due === tmr);
    return {
      text: capAfterNumber(`${evs.length} ${evs.length === 1 ? "event" : "events"} · ${due.length} ${due.length === 1 ? "task" : "tasks"} due`),
      provenance: { kind: "records", refs: evs.slice(0, 4).map((e) => ({ kind: "event", id: e.id, label: e.title })) },
    };
  }

  // "what's next"
  if (/^what('| i)?s next$/.test(q)) {
    const next = snap.events
      .filter((e) => e.date === snap.today && e.start >= snap.nowHHMM)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    if (!next) return { text: "Nothing else on the calendar today", provenance: { kind: "records" } };
    return {
      text: `${next.title} · ${fmt12(next.start)}`,
      provenance: { kind: "records", refs: [{ kind: "event", id: next.id, label: next.title }] },
    };
  }

  // "when is X"
  const when = q.match(/^when('| i)?s (.+)$|^when is (.+)$/);
  if (when) {
    const query = (when[2] ?? when[3] ?? "").trim();
    const evs = findByTitle(snap.events, (e) => e.title, query);
    if (evs.length === 1) {
      const e = evs[0]!;
      return {
        text: `${e.title} · ${capLead(dayWord(e.date, snap.today))} ${fmt12(e.start)}`,
        provenance: { kind: "records", refs: [{ kind: "event", id: e.id, label: e.title }] },
      };
    }
    const ts = findByTitle(snap.tasks.filter((t) => !t.done), (t) => t.text, query);
    if (evs.length === 0 && ts.length === 1) {
      const t = ts[0]!;
      return {
        text: t.due ? `${t.text} · Due ${dayWord(t.due, snap.today)}` : `${t.text} · No date`,
        provenance: { kind: "records", refs: [{ kind: "task", id: t.id, label: t.text }] },
      };
    }
    return null; // zero or ambiguous: the AI path or the chooser handles it
  }

  // "where is X"
  const where = q.match(/^where('| i)?s (.+)$|^where is (.+)$/);
  if (where) {
    const query = (where[2] ?? where[3] ?? "").trim();
    const evs = findByTitle(snap.events, (e) => e.title, query);
    if (evs.length === 1) {
      const e = evs[0]!;
      return e.location
        ? { text: `${e.title} · ${e.location}`, provenance: { kind: "records", refs: [{ kind: "event", id: e.id, label: e.title }] } }
        : { text: `${e.title} has no location saved`, provenance: { kind: "records", refs: [{ kind: "event", id: e.id, label: e.title }] } };
    }
    return null;
  }

  // "how much can i spend" / "what's left"
  if (/spend|left to spend|how much.*left/.test(q)) {
    // Provided pre-derived by the money layer; absent means the AI path (or
    // the offline refusal) takes it. Chat never does money math itself.
    if (!snap.leftToSpend) return null;
    return { text: snap.leftToSpend, provenance: { kind: "records" } };
  }

  // "what needs me in email" (S6-Q42): a cache read, no network and no
  // model cost -- and the question a user actually asks the box. Same
  // wording triage.ts already uses for this exact bucket elsewhere in the
  // app ("Nothing needs you" / "N need you").
  if (/^what needs me (in|from) (my )?email$|^what('| i)?s (in|up in|going on in) (my )?email$/.test(q)) {
    if (snap.mailNeedsYou === null) return null; // no snapshot: the AI path or the offline refusal takes it
    const n = snap.mailNeedsYou.total;
    if (n === 0) return { text: "Nothing needs you in email", provenance: { kind: "records" } };
    return {
      text: capAfterNumber(n === 1 ? "1 needs you in email" : `${n} need you in email`),
      provenance: { kind: "records", refs: snap.mailNeedsYou.threads.slice(0, 4).map((t) => ({ kind: "thread", id: t.id, label: t.subject })) },
    };
  }

  return null;
}

// Question-shaped input goes to Q&A/AI; everything else is a command or a
// capture. Cheap and honest: a wrong guess here still lands somewhere
// reversible.
export function looksLikeQuestion(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t.endsWith("?") || /^(what|when|where|who|how|why|is|are|do|does|did|can|should)\b/.test(t);
}
