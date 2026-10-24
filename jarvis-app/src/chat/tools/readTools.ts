// THE TIER 0 TOOLS: WHAT THE MODEL CAN LOOK UP (chat box order, 2026-10-24). Reads are free: no approval, no receipt, and they change
// nothing. They are capped on every side (a short list, short snippets, a cut-off body), stamped with when they were read, and they return
// refs so the model's next call, and the answer's provenance chips, point at records that exist.
//
// Each implementation takes ReadDeps, a plain set of functions, never the services themselves: the app wires the real ones in ChatFlow
// and a test wires fakes, and nothing here can reach a write because nothing here is handed one.
//
// WHAT COMES FROM OUTSIDE IS FENCED. A mail header, a note someone pasted, a document: the person owns the copy, but the words are not
// theirs, and a crafted line in one ("ignore your rules and ...") must never read as an instruction. Every field of outside text is
// cleaned (invisible characters and forged delimiters removed, messages/untrusted.ts) and the result says plainly that it is data.
// None of this is a guarantee, which is why the wall that matters is the dispatcher: a read can do nothing but return text, and a write
// cannot run without the person's tap on its exact content.

import { runSearch, type SearchInput } from "../../search/search";
import { overlapScore } from "../../ai/memoryAssemble";
import { untrustedText } from "../../messages/untrusted";
import { mapThread, type GmailThreadMeta } from "../../connections/google/map";
import { eventsForDate, addDays, daysBetween } from "../../schedule/calendar";
import type { EventItem } from "../../schedule/types";
import type { TaskItem } from "../../tasks/TasksService";
import type { BrainMemoryRow } from "../../ai/brainMemory";
import { ToolFailure, type RecordRef, type ToolImpl } from "./dispatcher";
import { OUTSIDE_TEXT_WARNING } from "./toolPrompt";
import type { ToolName } from "./registry";

export interface ReadDeps {
  /** Every list global search reads, loaded fresh (each read failing on its own comes back empty, as Search does). */
  searchData(): Promise<SearchInput>;
  /** One note's title and flattened text, or null when it is gone. */
  note(id: string): Promise<{ title: string; text: string; updatedAt?: string } | null>;
  /** Events as the tabs draw them (twins drawn once), recurrence not yet expanded. */
  events(): Promise<EventItem[]>;
  tasks(): Promise<TaskItem[]>;
  /** The connected mail, or null with none. Search only: nothing here can send, label or move. */
  mail(): Promise<{ searchThreads(q: string, max: number): Promise<GmailThreadMeta[]> } | null>;
  facts(): Promise<BrainMemoryRow[]>;
  /** What JARVIS did on the person's behalf since a time, newest first. */
  activity(sinceMs: number): Promise<{ at: string; text: string }[]>;
  /** Today, local, YYYY-MM-DD. */
  today(): string;
  /** memory_v1: a person is also found by an alias, a task by the person it is about. */
  links: boolean;
}

const FENCE_BEGIN = "<<<BEGIN UNTRUSTED>>>";
const FENCE_END = "<<<END UNTRUSTED>>>";

/** Outside text, cleaned and fenced, so it reads as a quotation and never as a command. */
export function fence(text: string): string {
  return `${FENCE_BEGIN}\n${untrustedText(text)}\n${FENCE_END}`;
}

const clip = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : one.slice(0, n - 1).trimEnd() + "…";
};

const DOC_CAP = 3000;
const MAX_WINDOW_DAYS = 31;
const FACT_CATEGORIES = new Set(["fact", "decision", "philosophy", "value"]);

interface Hit { ref: string; kind: string; title: string; when?: string; why?: string }

export function makeReadTools(deps: ReadDeps): Partial<Record<ToolName, ToolImpl>> {
  const search_items: ToolImpl = async (input) => {
    const query = String(input.query);
    const kinds = new Set<string>((input.kinds as string[] | undefined) ?? ["task", "event", "note", "person", "project", "goal", "decision", "file", "fact"]);
    const limit = Math.min(10, typeof input.limit === "number" ? input.limit : 6);
    const data = await deps.searchData();
    // Live state is rendered, never remembered: a finished task is absent unless it was asked for by name.
    const scoped: SearchInput = input.include_done === true ? data : { ...data, tasks: data.tasks.filter((t) => !t.data.done) };
    const r = runSearch(query, scoped, { links: deps.links });
    const dueOf = new Map(data.tasks.map((t) => [t.id, t.data.due ?? undefined]));
    const dateOf = new Map(data.events.map((e) => [e.id, e.data.date]));
    const hits: Hit[] = [];
    const add = (kind: string, id: string, title: string, why?: string, when?: string) => {
      if (kinds.has(kind)) hits.push({ ref: `${kind}:${id}`, kind, title: clip(title, 90), ...(when ? { when } : {}), ...(why ? { why: clip(why, 90) } : {}) });
    };
    for (const t of r.tasks) add("task", t.id, t.text, t.why, dueOf.get(t.id) ?? undefined);
    for (const e of r.events) add("event", e.id, e.title, e.why, [dateOf.get(e.id), e.start].filter(Boolean).join(" "));
    for (const n of r.notes) add("note", n.id, n.title, n.why);
    for (const p of r.people) add("person", p.id, p.name, p.why);
    for (const p of r.projects) add("project", p.id, p.title, p.why);
    for (const g of r.goals) add("goal", g.id, g.title, g.why);
    for (const d of r.decisions) add("decision", d.id, d.decision, d.why);
    for (const f of r.files) add("file", f.id, f.name, f.why);
    for (const f of r.facts) add("fact", f.id, f.text, f.why);
    const shown = hits.slice(0, limit);
    return {
      data: { query, items: shown, total: hits.length, ...(hits.length > shown.length ? { more: hits.length - shown.length } : {}) },
      refs: shown.map((h): RecordRef => ({ kind: h.kind, id: h.ref.slice(h.kind.length + 1), label: h.title })),
    };
  };

  const read_document: ToolImpl = async (input) => {
    const ref = String(input.ref);
    const kind = ref.slice(0, ref.indexOf(":"));
    const id = ref.slice(ref.indexOf(":") + 1);
    if (kind !== "note") throw new ToolFailure("unsupported", "Only notes can be read here for now; other kinds can be searched but not opened");
    const n = await deps.note(id);
    if (!n) throw new ToolFailure("not_found", "That note no longer exists.");
    return {
      data: {
        ref,
        title: clip(n.title, 120),
        ...(n.updatedAt ? { updatedAt: n.updatedAt } : {}),
        untrusted: true,
        text: fence(n.text.slice(0, DOC_CAP)),
        ...(n.text.length > DOC_CAP ? { truncated: true, chars: n.text.length } : {}),
      },
      refs: [{ kind: "note", id, label: clip(n.title, 90) }],
    };
  };

  const get_schedule: ToolImpl = async (input) => {
    const from = String(input.from);
    const to = String(input.to);
    const span = daysBetween(from, to);
    if (!Number.isFinite(span) || span < 0) throw new ToolFailure("bad_window", "The end date is before the start date.");
    if (span + 1 > MAX_WINDOW_DAYS) throw new ToolFailure("bad_window", `Ask for at most ${MAX_WINDOW_DAYS} days at a time.`);
    const [events, tasks] = await Promise.all([deps.events(), deps.tasks()]);
    const evs: { ref: string; title: string; date: string; start: string; end?: string; location?: string }[] = [];
    for (let i = 0; i <= span && evs.length < 40; i++) {
      for (const e of eventsForDate(events, addDays(from, i))) {
        evs.push({ ref: `event:${e.id}`, title: clip(e.data.title, 90), date: e.data.date, start: e.data.start, ...(e.data.end ? { end: e.data.end } : {}), ...(e.data.location ? { location: clip(e.data.location, 60) } : {}) });
      }
    }
    const open = tasks.filter((t) => !t.data.done && t.data.due);
    const due = open.filter((t) => t.data.due! >= from && t.data.due! <= to).slice(0, 30)
      .map((t) => ({ ref: `task:${t.id}`, title: clip(t.data.text, 90), due: t.data.due! }));
    // "Late" is only meaningful when the window reaches today: it is what was due before today and is still open.
    const today = deps.today();
    const late = from <= today && today <= to
      ? open.filter((t) => t.data.due! < today).sort((a, b) => a.data.due!.localeCompare(b.data.due!)).slice(0, 10)
          .map((t) => ({ ref: `task:${t.id}`, title: clip(t.data.text, 90), due: t.data.due! }))
      : [];
    const refs: RecordRef[] = [
      ...evs.map((e): RecordRef => ({ kind: "event", id: e.ref.slice(6), label: e.title })),
      ...due.map((t): RecordRef => ({ kind: "task", id: t.ref.slice(5), label: t.title })),
      ...late.map((t): RecordRef => ({ kind: "task", id: t.ref.slice(5), label: t.title })),
    ];
    return { data: { from, to, today, events: evs, tasksDue: due, ...(late.length ? { late } : {}) }, refs };
  };

  const search_email: ToolImpl = async (input) => {
    const api = await deps.mail();
    if (!api) throw new ToolFailure("no_mail", "No mail account is connected, so there is nothing to search.");
    const limit = Math.min(6, typeof input.limit === "number" ? input.limit : 4);
    const metas = await api.searchThreads(String(input.query), limit);
    const rows = metas.map(mapThread).filter((t): t is NonNullable<ReturnType<typeof mapThread>> => !!t).slice(0, limit);
    const items = rows.map((t) => ({
      ref: `thread:${t.id}`,
      from: clip(untrustedText(t.from), 60),
      subject: clip(untrustedText(t.subject), 100),
      snippet: clip(untrustedText(t.snippet), 140),
      date: t.dateMs ? new Date(t.dateMs).toISOString().slice(0, 10) : undefined,
      unread: t.unread,
      messages: t.count,
    }));
    return {
      data: {
        untrusted: true,
        warning: OUTSIDE_TEXT_WARNING,
        items,
      },
      refs: rows.map((t): RecordRef => ({ kind: "thread", id: t.id, label: clip(t.subject, 90) })),
    };
  };

  const recall_facts: ToolImpl = async (input) => {
    const query = String(input.query);
    const limit = Math.min(8, typeof input.limit === "number" ? input.limit : 5);
    const rows = (await deps.facts()).filter((r) => FACT_CATEGORIES.has(r.data.category) && r.data.status !== "archived" && r.data.status !== "reversed" && !r.data.supersededBy);
    const items = rows
      .map((r) => ({ r, score: overlapScore(query, `${r.data.text} ${r.data.why ?? ""}`) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ r }) => ({
        kind: r.data.category,
        text: clip(r.data.text, 300),
        ...(r.data.why ? { why: clip(r.data.why, 200) } : {}),
        filed: r.data.date ?? r.created_at.slice(0, 10),
        // Law 4: said by the person, so it is labelled so. Nothing a tool returns here is a guess.
        label: "STATED",
      }));
    return { data: { query, items } };
  };

  const get_activity: ToolImpl = async (input, ctx) => {
    const days = typeof input.days === "number" ? input.days : 3;
    const rows = await deps.activity(ctx.now.getTime() - days * 86_400_000);
    return { data: { days, items: rows.slice(0, 12).map((a) => ({ at: a.at, text: clip(a.text, 140) })) } };
  };

  return { search_items, read_document, get_schedule, search_email, recall_facts, get_activity };
}
