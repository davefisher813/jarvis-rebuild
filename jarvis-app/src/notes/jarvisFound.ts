import type { AIService } from "../ai/AIService";
import type { NoteData, FoundCandidate } from "./types";
import { noteBlockText } from "../search/search";

// JARVIS FOUND (C-20, Astra, 2026-09-12). When a note loses focus after an
// edit and its text has changed by more than PASS_DELTA characters since
// the last pass, one structured call reads the note and names up to six
// candidates: tasks (text, due phrase), decisions (text), people (a name),
// projects (a title). Nothing is written without a tap: Add writes a task
// or a decision with the note as source, Link writes a connection. People
// and projects are matched HERE against the user's own lists, by name, and
// an unmatched one is dropped: the model never sees the lists and never
// gets to invent a contact.
//
// Gated on AI being on. No chat, no Ask, no Summarize (C-13 stands).

export const PASS_DELTA = 40;
export const FOUND_CAP = 6;

export const FOUND_SCHEMA = {
  type: "object",
  properties: {
    tasks: { type: "array", items: { type: "object", properties: { text: { type: "string" }, due: { type: "string" } }, required: ["text"] } },
    decisions: { type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
    people: { type: "array", items: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
    projects: { type: "array", items: { type: "object", properties: { title: { type: "string" } }, required: ["title"] } },
  },
  required: ["tasks", "decisions", "people", "projects"],
} as const;

export const FOUND_SYSTEM = [
  "You read one note the user wrote and name what is in it, in the required shape.",
  "tasks: things the user or someone they name has to do, with the due phrase exactly as written when there is one.",
  "decisions: calls that were made, stated as a settled line.",
  "people: personal names mentioned. projects: named pieces of work mentioned.",
  "At most six items in total. Say nothing the note does not say. No advice, no summary.",
].join(" ");

interface Reply {
  tasks?: { text?: string; due?: string }[];
  decisions?: { text?: string }[];
  people?: { name?: string }[];
  projects?: { title?: string }[];
}

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** The candidates from a reply, matched against his lists. Pure. */
export function foundFromReply(
  raw: string,
  people: { id: string; name: string }[],
  projects: { id: string; title: string }[],
): FoundCandidate[] {
  let r: Reply;
  try { r = JSON.parse(raw) as Reply; } catch { return []; }
  const out: FoundCandidate[] = [];
  for (const t of r.tasks ?? []) {
    const text = clean(t.text); if (!text) continue;
    const due = clean(t.due);
    out.push({ kind: "task", text, ...(due ? { due } : {}) });
  }
  for (const d of r.decisions ?? []) {
    const text = clean(d.text); if (text) out.push({ kind: "decision", text });
  }
  for (const p of r.people ?? []) {
    const name = clean(p.name).toLowerCase(); if (!name) continue;
    const hits = people.filter((x) => {
      const n = x.name.trim().toLowerCase();
      return n === name || n.startsWith(name + " ") || n.split(" ")[0] === name;
    });
    // One match or none: two people answering to a first name is the
    // Uncertainty Protocol's own case, and a wrong link is worse than none.
    if (hits.length === 1) out.push({ kind: "person", text: hits[0]!.name, targetId: hits[0]!.id });
  }
  for (const p of r.projects ?? []) {
    const title = clean(p.title).toLowerCase(); if (!title) continue;
    const hits = projects.filter((x) => { const t = x.title.trim().toLowerCase(); return t === title || t.includes(title) || title.includes(t); });
    if (hits.length === 1) out.push({ kind: "project", text: hits[0]!.title, targetId: hits[0]!.id });
  }
  // One row per thing: the same task twice is one task.
  const seen = new Set<string>();
  return out.filter((c) => { const k = c.kind + ":" + (c.targetId ?? c.text.toLowerCase()); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, FOUND_CAP);
}

export async function findInNote(
  ai: Pick<AIService, "available" | "complete">,
  note: NoteData,
  people: { id: string; name: string }[],
  projects: { id: string; title: string }[],
): Promise<FoundCandidate[]> {
  if (!ai.available) return [];
  const text = [note.title, noteBlockText(note)].filter(Boolean).join("\n").trim();
  if (text.length < PASS_DELTA) return [];
  const raw = await ai.complete(
    [{ role: "user", content: text.slice(0, 6000) }],
    FOUND_SYSTEM,
    { kind: "note_found", background: true, schema: FOUND_SCHEMA as unknown as Record<string, unknown> },
  );
  return foundFromReply(raw, people, projects);
}

/** The text length a pass was last run at, for the 40-character gate. */
export function passLength(note: NoteData): number {
  return [note.title, noteBlockText(note)].filter(Boolean).join("\n").trim().length;
}
