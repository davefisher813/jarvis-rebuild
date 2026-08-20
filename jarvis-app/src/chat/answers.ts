// Chat's deterministic Q&A layer (addendum item 23). Runs BEFORE any AI
// call (cost guard). Answers come FROM RECORDS: numbers are computed here,
// refs point at the rows used, and an unknown question returns null so the
// grounded AI path (or an honest refusal offline) can take it. Never a
// guess: a fuzzy title match below the floor is a null, not a shrug.

import type { ChatProvenance } from "./types";
import { capAfterNumber } from "../shared/casing";

export interface AnswerSnapshot {
  today: string;
  events: { id: string; title: string; date: string; start: string; location?: string }[];
  tasks: { id: string; text: string; due?: string | null; done: boolean }[];
  // Money's derived left-to-spend line, already computed by the money layer;
  // null when money is not set up. Chat never does money math itself.
  leftToSpend: string | null;
  nowHHMM: string;
}

export interface ChatAnswer {
  text: string;
  provenance: ChatProvenance;
}

const fmt12 = (hhmm: string): string => {
  const h = parseInt(hhmm.slice(0, 2), 10);
  const m = parseInt(hhmm.slice(3), 10);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ap}` : `${h12}:${String(m).padStart(2, "0")} ${ap}`;
};

const dayWord = (iso: string, today: string): string => {
  if (iso === today) return "today";
  const diff = Math.round((Date.parse(iso + "T12:00:00") - Date.parse(today + "T12:00:00")) / 86400000);
  if (diff === 1) return "tomorrow";
  const d = new Date(iso + "T12:00:00");
  if (diff > 1 && diff < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

export function answerQuestion(raw: string, snap: AnswerSnapshot): ChatAnswer | null {
  const q = raw.trim().toLowerCase().replace(/[?.!]+$/, "");

  // "what's today" / "what does today look like"
  if (/^(what('| i)?s (on )?today|what does today look like|today)$/.test(q)) {
    const evs = snap.events.filter((e) => e.date === snap.today);
    const due = snap.tasks.filter((t) => !t.done && t.due === snap.today);
    return {
      text: capAfterNumber(`${evs.length} ${evs.length === 1 ? "event" : "events"} · ${due.length} ${due.length === 1 ? "task" : "tasks"} due`),
      provenance: { kind: "records" },
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
        text: `${e.title} · ${dayWord(e.date, snap.today)} ${fmt12(e.start)}`,
        provenance: { kind: "records", refs: [{ kind: "event", id: e.id, label: e.title }] },
      };
    }
    const ts = findByTitle(snap.tasks.filter((t) => !t.done), (t) => t.text, query);
    if (evs.length === 0 && ts.length === 1) {
      const t = ts[0]!;
      return {
        text: t.due ? `${t.text} · due ${dayWord(t.due, snap.today)}` : `${t.text} · no date`,
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

  return null;
}

// Question-shaped input goes to Q&A/AI; everything else is a command or a
// capture. Cheap and honest: a wrong guess here still lands somewhere
// reversible.
export function looksLikeQuestion(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t.endsWith("?") || /^(what|when|where|who|how|why|is|are|do|does|did|can|should)\b/.test(t);
}
