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
import type { UserFile } from "../files/types";
import type { Strand } from "../brain/strands/types";

// UP-CORE-04 (2026-09-05): WHY THIS ROW IS HERE. Search reads the fields
// things were actually typed into now, not just their titles, so a hit whose
// title does not contain the query would otherwise read as a bug. `why` is
// the matched line, labelled with the field it came from ("Location: Rink
// 2"), and it is absent when the title itself carried the match.
export interface SearchResults {
  events: { id: string; title: string; start: string; why?: string }[];
  tasks: { id: string; text: string; why?: string }[];
  people: { id: string; name: string; why?: string }[];
  notes: { id: string; title: string; why?: string }[];
  projects: { id: string; title: string; why?: string }[];
  accounts: { id: string; name: string; why?: string }[];
  goals: { id: string; title: string; why?: string }[];
  categories: { id: string; name: string; why?: string }[];
  decisions: { id: string; decision: string; why?: string }[];
  files: { id: string; name: string; why?: string }[];
  facts: { id: string; text: string; why?: string }[];
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
  // UP-CORE-04: "where did I put the dentist's number" is only answerable if
  // search reads where it was typed. Optional so a caller that does not hold
  // these lists (a test, a narrower surface) still type-checks.
  files?: UserFile[];
  strands?: Strand[];
}

const EMPTY: SearchResults = { events: [], tasks: [], people: [], notes: [], projects: [], accounts: [], goals: [], categories: [], decisions: [], files: [], facts: [] };

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

// One matched line, short enough to sit under a title. Cut on a word where
// there is one, so the snippet does not end mid-name.
const SNIPPET_MAX = 72;
function snippet(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= SNIPPET_MAX) return one;
  const cut = one.slice(0, SNIPPET_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > SNIPPET_MAX / 2 ? cut.slice(0, space) : cut) + "...";
}

// The first field that actually contains the query, said in words: the field
// name (Title Case, it names a thing) and the user's own text after it,
// never rewritten.
function whyFrom(q: string, fields: [string, string | undefined][]): string | undefined {
  for (const [label, value] of fields) {
    if (value && value.toLowerCase().includes(q)) return `${label}: ${snippet(value)}`;
  }
  return undefined;
}

// Client-side full-text match across everything the user owns. Case-insensitive
// substring on the human-facing field of each type, and on the fields inside
// it that the user typed something into (UP-CORE-04).
export function runSearch(query: string, data: SearchInput): SearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return EMPTY;
  const has = (s: string | undefined) => !!s && s.toLowerCase().includes(q);
  // Full-text over a note: title plus everything noteBlockText carries.
  const noteHas = (d: NoteData) => has(d.title) || has(noteBlockText(d));
  // The block line that matched, so a note hit says which line put it here.
  const noteWhy = (d: NoteData) => has(d.title) ? undefined
    : whyFrom(q, [["Note", noteBlockText(d).split(BLOCK_JOIN).find((part) => part.toLowerCase().includes(q))]]);
  // TRACE-02 (2026-09-07): the label a person reads is Checklist, never
  // Steps. "No surface calls a task a step" (pick 30, laws.test.ts) has been
  // law since the project page and the Tasks tab called the same records two
  // different things; TaskSheet's own group says Checklist. This line said
  // "Steps:" because the law scanned .tsx only and a why-line lives in a .ts.
  const stepWhy = (t: TaskItem) => has(t.data.text) ? undefined
    : whyFrom(q, [["Checklist", (t.data.steps ?? []).find((s) => s.text.toLowerCase().includes(q))?.text]]);
  return {
    events: data.events
      .filter((e) => has(e.data.title) || has(e.data.location))
      .map((e) => ({ id: e.id, title: e.data.title, start: e.data.start, ...whyOf(has(e.data.title) ? undefined : whyFrom(q, [["Location", e.data.location]])) })),
    tasks: data.tasks
      .filter((t) => has(t.data.text) || (t.data.steps ?? []).some((s) => has(s.text)))
      .map((t) => ({ id: t.id, text: t.data.text, ...whyOf(stepWhy(t)) })),
    people: data.people
      .filter((p) => has(p.data.name) || has(p.data.notes) || has(p.data.email) || has(p.data.phone) || has(p.data.relationship))
      .map((p) => ({
        id: p.id,
        name: p.data.name,
        ...whyOf(has(p.data.name) ? undefined : whyFrom(q, [
          ["Phone", p.data.phone], ["Email", p.data.email], ["Relationship", p.data.relationship], ["Notes", p.data.notes],
        ])),
      })),
    notes: data.notes.filter((n) => noteHas(n.data as unknown as NoteData)).map((n) => ({
      id: n.id,
      title: (n.data as unknown as NoteData).title || "Untitled",
      ...whyOf(noteWhy(n.data as unknown as NoteData)),
    })),
    projects: data.projects.filter((p) => has(p.data.title)).map((p) => ({ id: p.id, title: p.data.title })),
    accounts: data.accounts.filter((a) => has(a.data.name)).map((a) => ({ id: a.id, name: a.data.name })),
    goals: data.goals.filter((g) => has(g.data.title)).map((g) => ({ id: g.id, title: g.data.title })),
    categories: data.categories.filter((c) => has(c.data.name)).map((c) => ({ id: c.id, name: c.data.name })),
    // Decision text and the reason both match: the reason is the payoff.
    decisions: (data.decisions ?? []).filter((d) => has(d.data.decision) || has(d.data.why)).map((d) => ({
      id: d.id,
      decision: d.data.decision,
      ...whyOf(has(d.data.decision) ? undefined : whyFrom(q, [["Why", d.data.why]])),
    })),
    // A receipt or a statement is findable by the name it was saved under.
    files: (data.files ?? []).filter((f) => has(f.data.name)).map((f) => ({ id: f.id, name: f.data.name })),
    // What JARVIS knows, in the words it says it in.
    facts: (data.strands ?? []).filter((s) => has(s.data.text)).map((s) => ({ id: s.id, text: s.data.text })),
  };
}

// Spread-or-nothing, so a hit that matched on its own title carries no `why`
// key at all rather than an explicit undefined.
function whyOf(why: string | undefined): { why?: string } {
  return why ? { why } : {};
}

export function totalHits(r: SearchResults): number {
  return r.events.length + r.tasks.length + r.people.length + r.notes.length + r.projects.length + r.accounts.length + r.goals.length + r.categories.length + r.decisions.length + r.files.length + r.facts.length;
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
  for (const e of data.events) { eat(e.data.title); eat(e.data.location); }
  for (const t of data.tasks) { eat(t.data.text); for (const st of t.data.steps ?? []) eat(st.text); }
  for (const p of data.people) { eat(p.data.name); eat(p.data.relationship); eat(p.data.notes); }
  for (const f of data.files ?? []) eat(f.data.name);
  for (const st of data.strands ?? []) eat(st.data.text);
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
