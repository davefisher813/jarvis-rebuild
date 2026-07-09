import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";
import type { Person } from "../people/types";
import type { Item } from "@core";
import type { NoteData } from "../notes/types";
import type { Project } from "../projects/types";
import type { Account } from "../money/types";
import type { Goal } from "../life/types";
import type { Category } from "../categories/types";

export interface SearchResults {
  events: { id: string; title: string; start: string }[];
  tasks: { id: string; text: string }[];
  people: { id: string; name: string }[];
  notes: { id: string; title: string }[];
  projects: { id: string; title: string }[];
  accounts: { id: string; name: string }[];
  goals: { id: string; title: string }[];
  categories: { id: string; name: string }[];
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
}

const EMPTY: SearchResults = { events: [], tasks: [], people: [], notes: [], projects: [], accounts: [], goals: [], categories: [] };

// Client-side full-text match across everything the user owns. Case-insensitive
// substring on the human-facing field of each type.
export function runSearch(query: string, data: SearchInput): SearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return EMPTY;
  const has = (s: string | undefined) => !!s && s.toLowerCase().includes(q);
  return {
    events: data.events.filter((e) => has(e.data.title)).map((e) => ({ id: e.id, title: e.data.title, start: e.data.start })),
    tasks: data.tasks.filter((t) => has(t.data.text)).map((t) => ({ id: t.id, text: t.data.text })),
    people: data.people.filter((p) => has(p.data.name)).map((p) => ({ id: p.id, name: p.data.name })),
    notes: data.notes.filter((n) => has((n.data as unknown as NoteData).title)).map((n) => ({ id: n.id, title: (n.data as unknown as NoteData).title || "Untitled" })),
    projects: data.projects.filter((p) => has(p.data.title)).map((p) => ({ id: p.id, title: p.data.title })),
    accounts: data.accounts.filter((a) => has(a.data.name)).map((a) => ({ id: a.id, name: a.data.name })),
    goals: data.goals.filter((g) => has(g.data.title)).map((g) => ({ id: g.id, title: g.data.title })),
    categories: data.categories.filter((c) => has(c.data.name)).map((c) => ({ id: c.id, name: c.data.name })),
  };
}

export function totalHits(r: SearchResults): number {
  return r.events.length + r.tasks.length + r.people.length + r.notes.length + r.projects.length + r.accounts.length + r.goals.length + r.categories.length;
}
