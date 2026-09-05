import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";
import type { Person } from "../people/types";
import type { Item } from "@core";
import type { NoteData } from "../notes/types";
import type { Project } from "../projects/types";
import type { Account } from "../money/types";
import type { Goal } from "../life/types";
import type { Category } from "../categories/types";
import type { DecisionRecord } from "../decisions/types";

export interface SearchResults {
  events: { id: string; title: string; start: string }[];
  tasks: { id: string; text: string }[];
  people: { id: string; name: string }[];
  notes: { id: string; title: string }[];
  projects: { id: string; title: string }[];
  accounts: { id: string; name: string }[];
  goals: { id: string; title: string }[];
  categories: { id: string; name: string }[];
  decisions: { id: string; decision: string }[];
}

export interface SearchInput {
  tasks: TaskItem[];
  events: EventItem[];
  notes: Item[];
  people: Person[];
  projects: Project[];
  accounts: Account[];
  goals: Goal[];
  categories: Category[];
  // Live decisions only: a superseded record is reachable through its
  // successor's Replaces block, not through search.
  decisions?: DecisionRecord[];
}

const EMPTY: SearchResults = { events: [], tasks: [], people: [], notes: [], projects: [], accounts: [], goals: [], categories: [], decisions: [] };

// Everything inside a note's blocks, flattened into one search haystack:
// headings, paragraphs, checklist and list items, table cells, attachment
// names. Joined on a control-picture glyph nobody types, so words from
// adjacent fields never fuse into an accidental match.
//
// S6-Q37 (2026-09-04): "Notes' in-page search ignores note bodies." Exported
// so the Notes tab's own in-page search (NotesFlow.tsx, NotesList.tsx) can
// build the exact same haystack this file matches against -- one extraction,
// used by both, so a note that matches global search always matches there
// too.
const BLOCK_JOIN = " ␟ ";
export function noteBlockText(d: NoteData): string {
  const parts: string[] = [];
  for (const b of d.blocks ?? []) {
    if (b.text) parts.push(b.text);
    if (b.name) parts.push(b.name);
    for (const it of b.items ?? []) parts.push(typeof it === "string" ? it : it.text ?? "");
    for (const col of b.columns ?? []) parts.push(col);
    for (const row of b.rows ?? []) for (const cell of row) parts.push(cell);
  }
  return parts.join(BLOCK_JOIN);
}

// Client-side full-text match across everything the user owns. Case-insensitive
// substring on the human-facing field of each type.
export function runSearch(query: string, data: SearchInput): SearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return EMPTY;
  const has = (s: string | undefined) => !!s && s.toLowerCase().includes(q);
  // Full-text over a note: title plus everything noteBlockText carries.
  const noteHas = (d: NoteData) => has(d.title) || has(noteBlockText(d));
  return {
    events: data.events.filter((e) => has(e.data.title)).map((e) => ({ id: e.id, title: e.data.title, start: e.data.start })),
    tasks: data.tasks.filter((t) => has(t.data.text)).map((t) => ({ id: t.id, text: t.data.text })),
    people: data.people.filter((p) => has(p.data.name)).map((p) => ({ id: p.id, name: p.data.name })),
    notes: data.notes.filter((n) => noteHas(n.data as unknown as NoteData)).map((n) => ({ id: n.id, title: (n.data as unknown as NoteData).title || "Untitled" })),
    projects: data.projects.filter((p) => has(p.data.title)).map((p) => ({ id: p.id, title: p.data.title })),
    accounts: data.accounts.filter((a) => has(a.data.name)).map((a) => ({ id: a.id, name: a.data.name })),
    goals: data.goals.filter((g) => has(g.data.title)).map((g) => ({ id: g.id, title: g.data.title })),
    categories: data.categories.filter((c) => has(c.data.name)).map((c) => ({ id: c.id, name: c.data.name })),
    // Decision text and the reason both match: the reason is the payoff.
    decisions: (data.decisions ?? []).filter((d) => has(d.data.decision) || has(d.data.why)).map((d) => ({ id: d.id, decision: d.data.decision })),
  };
}

export function totalHits(r: SearchResults): number {
  return r.events.length + r.tasks.length + r.people.length + r.notes.length + r.projects.length + r.accounts.length + r.goals.length + r.categories.length + r.decisions.length;
}

// ---- Type-ahead ------------------------------------------------------------

// Every distinct word (3+ chars) across the user's searchable text, for
// completing the word being typed. Built once per search session.
export function buildSuggestionIndex(data: SearchInput): string[] {
  const words = new Set<string>();
  const eat = (s: string | undefined) => {
    if (!s) return;
    for (const w of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w.length >= 3) words.add(w);
  };
  for (const e of data.events) eat(e.data.title);
  for (const t of data.tasks) eat(t.data.text);
  for (const p of data.people) eat(p.data.name);
  for (const p of data.projects) eat(p.data.title);
  for (const a of data.accounts) eat(a.data.name);
  for (const g of data.goals) eat(g.data.title);
  for (const c of data.categories) eat(c.data.name);
  for (const d of data.decisions ?? []) { eat(d.data.decision); eat(d.data.why); }
  for (const n of data.notes) {
    const d = n.data as unknown as NoteData;
    eat(d.title);
    for (const b of d.blocks ?? []) {
      eat(b.text); eat(b.name);
      for (const it of b.items ?? []) eat(typeof it === "string" ? it : it.text);
      for (const col of b.columns ?? []) eat(col);
      for (const row of b.rows ?? []) for (const cell of row) eat(cell);
    }
  }
  return Array.from(words).sort();
}

// Complete the word currently being typed (the last token of the query).
// Returns full replacement queries, so tapping a suggestion finishes the word.
export function suggest(query: string, index: string[], limit = 5): string[] {
  const raw = query.toLowerCase();
  const parts = raw.split(/\s+/);
  const last = parts[parts.length - 1] ?? "";
  if (last.length < 2) return [];
  const head = raw.slice(0, raw.length - last.length);
  const out: string[] = [];
  for (const w of index) {
    if (w.startsWith(last) && w !== last) {
      out.push(head + w);
      if (out.length >= limit) break;
    }
  }
  return out;
}
