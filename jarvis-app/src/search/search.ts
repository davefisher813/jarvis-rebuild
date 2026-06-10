import type { TaskItem } from "../tasks/TasksService";
import type { EventItem } from "../schedule/types";
import type { Person } from "../people/types";
import type { Item } from "@core";
import type { NoteData } from "../notes/types";

export interface SearchResults {
  events: { id: string; title: string; start: string }[];
  tasks: { id: string; text: string }[];
  people: { id: string; name: string }[];
  notes: { id: string; title: string }[];
}

export interface SearchInput {
  tasks: TaskItem[];
  events: EventItem[];
  notes: Item[];
  people: Person[];
}

const EMPTY: SearchResults = { events: [], tasks: [], people: [], notes: [] };

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
  };
}

export function totalHits(r: SearchResults): number {
  return r.events.length + r.tasks.length + r.people.length + r.notes.length;
}
