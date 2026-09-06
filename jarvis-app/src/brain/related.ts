import { namePatterns } from "../people/mentions";

// WHAT IS LINKED TO THE SITUATION, NOT EVERYTHING (UP-MIND-23, Brain build
// order 12 and 5.9).
//
// ai/context.ts said it out loud: "unscoped until relevance scoping ships".
// Every prompt in the app carried every strand, every settled decision,
// every bill and every goal, whether it was drafting a reply to a plumber or
// planning a workout. That costs tokens on every call and, worse, buries the
// one fact that matters for THIS draft under forty that do not.
//
// The links already exist and nothing walked them: decisions carry
// linkedType person | project | task, notes carry connections, tasks carry a
// thread and now a person (UP-MIND-10), and threads carry a project link.
// This is the walk: ONE HOP from the thing in hand, ranked, capped, and
// returned as plain lines.
//
// Three rules:
//   - One hop only. Two hops from a person reaches most of the graph, and a
//     context that reaches everything is the unscoped list again.
//   - The anchor decides. With no anchor this returns nothing and every
//     caller keeps the behaviour it had.
//   - Lines, never records. What the prompt gets is sentences about what is
//     linked, which is the same shape every other context block uses.

export interface Anchor {
  personId?: string;
  personName?: string;
  projectId?: string;
  threadId?: string;
}

export interface RelatedStores {
  tasks: { id: string; text: string; done?: boolean; due?: string | null; personId?: string; projectId?: string; fromThread?: string }[];
  events: { id: string; title: string; date: string; location?: string }[];
  decisions: { decision: string; why?: string; linkedType?: string; linkedId?: string }[];
  notes: { title: string; connections?: { type: string; id: string }[] }[];
  strands: { text: string; category?: string }[];
  /** Which project a thread is linked to, when one is. */
  threadProject?: (threadId: string) => string | undefined;
  projects: { id: string; title: string }[];
  today: string;
}

// Enough to matter, few enough to read. A related block longer than this is
// the unscoped list with an extra step.
export const RELATED_CAP = 12;

const isEmpty = (a: Anchor) => !a.personId && !a.personName && !a.projectId && !a.threadId;

/** One hop from the anchor, as plain lines. Empty when there is no anchor,
 *  which is what keeps every existing caller unchanged. */
export function relatedLines(anchor: Anchor, s: RelatedStores): string[] {
  if (isEmpty(anchor)) return [];
  const out: string[] = [];
  // A thread's project counts as an anchor of its own: working on this
  // conversation IS working on that project.
  const projectId = anchor.projectId
    ?? (anchor.threadId && s.threadProject ? s.threadProject(anchor.threadId) : undefined);
  const pats = anchor.personName ? namePatterns(anchor.personName) : [];
  const mentions = (text: string) => pats.length > 0 && pats.some((re) => re.test(text));

  const project = projectId ? s.projects.find((p) => p.id === projectId) : undefined;
  if (project) out.push(`Working on: ${project.title}`);

  // Open work with this person or on this project. The stored person link
  // wins over the name match, for the reason people/mentions.ts exists: a
  // wrong link attaches someone else's work to a name.
  for (const t of s.tasks) {
    if (t.done) continue;
    const byPerson = !!anchor.personId && t.personId === anchor.personId;
    const byProject = !!projectId && t.projectId === projectId;
    const byThread = !!anchor.threadId && t.fromThread === anchor.threadId;
    if (!byPerson && !byProject && !byThread && !mentions(t.text)) continue;
    out.push(t.due ? `Still open: ${t.text} (due ${t.due})` : `Still open: ${t.text}`);
  }

  // Time already booked that names them. Past events are history, and this
  // block is about what is live.
  for (const e of s.events) {
    if (e.date < s.today) continue;
    if (!mentions(e.title) && !mentions(e.location ?? "")) continue;
    out.push(`On the calendar: ${e.title} (${e.date})`);
  }

  // Decisions attached to the person or the project. A settled decision is
  // the single most expensive thing to re-open, which is why it earns its
  // place in a scoped block.
  for (const d of s.decisions) {
    const linked = (d.linkedType === "person" && d.linkedId === anchor.personId)
      || (d.linkedType === "project" && d.linkedId === projectId);
    if (!linked && !mentions(d.decision)) continue;
    out.push(d.why ? `Already decided: ${d.decision} (because ${d.why})` : `Already decided: ${d.decision}`);
  }

  // Notes connected to them.
  for (const n of s.notes) {
    const linked = (n.connections ?? []).some((c) =>
      (c.type === "person" && c.id === anchor.personId) || (c.type === "project" && c.id === projectId));
    if (!linked) continue;
    out.push(`Note: ${n.title}`);
  }

  return out.slice(0, RELATED_CAP);
}

/** The strands worth carrying for this situation: the bucket the caller
 *  names, plus anything that mentions the person by name. This is what
 *  REPLACES the unscoped list when an anchor is given. */
export function relatedStrands(
  anchor: Anchor,
  strands: { text: string; category?: string }[],
  bucket?: string,
): string[] {
  if (isEmpty(anchor)) return strands.map((x) => x.text);
  const pats = anchor.personName ? namePatterns(anchor.personName) : [];
  return strands
    .filter((x) => (bucket && x.category === bucket) || pats.some((re) => re.test(x.text)))
    .map((x) => x.text)
    .slice(0, RELATED_CAP);
}
