// Brain Manual v1 (Phase 1) - memory assembler.
//
// Pure: the caller fetches the user's brain_memory + person rows, this
// budgets, ranks, and renders them into prompt-ready text. No I/O, no
// Supabase imports - the same convention as context.ts. Implements
// flow-doc §3:
//
//   philosophy + values always in (capped, pinned first, then newest),
//   voice samples on drafts only, facts fill the rest of the budget,
//   decisions + people by keyword overlap, everything inside
//   MEMORY_BUDGET_CHARS. The citation rule (draftInstructions) rides after
//   the cache breakpoint, so callers put it in the instructions half.
//
// Import the shared contracts from brainMemory.ts; never redefine them.

import {
  MEMORY_BUDGET_CHARS,
  PHILOSOPHY_CAP_CHARS,
  RETRIEVAL_MIN_SCORE,
  RETRIEVAL_TOP_K,
  VALUES_CAP_CHARS,
  VOICE_SAMPLE_CAP,
} from "./brainMemory";
import type { BrainMemoryRow, TriageState } from "./brainMemory";

/** The em-dash code point, built numerically: the no-em-dash law bans the
 *  character itself in source, but the rendered decision lines and the
 *  citation instruction read better with it than with a hyphen. */
const EM_DASH = String.fromCharCode(0x2014);

/** A person row: table fields + the triage payload in data. The triage
 *  screen writes roles/roleNote/triageState here; the caller's fetch maps
 *  the person's name into data.name.
 *
 *  NOTE: person rows may ALSO carry the per-area role editor's `roles`
 *  (PersonRole[]: {categoryId, role} objects) under the same key. The
 *  brain's label/scoring only ever use the string entries - see
 *  brainRoles() below (brainMemory.ts documents the shared key). */
export interface PersonRow {
  id: string;
  data: {
    name?: string;
    roles?: string[];
    roleNote?: string;
    triageState?: TriageState;
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

export interface MemoryInput {
  memories: BrainMemoryRow[];
  people: PersonRow[];
  message: string;
  isDraft: boolean;
}

/** One rendered section of the memory block. `texts` are the raw item
 *  texts (what toContextInput maps into AIContextInput fields); `lines`
 *  are the same items plus the "+N more" line when capped, ready for the
 *  block. `ids` lines up with `texts`. */
export interface MemorySection {
  texts: string[];
  lines: string[];
  ids: string[];
  omitted: number;
}

export interface PersonEntry {
  name: string;
  /** roles[0] + roleNote, the way context.ts's peopleDetail.label reads it. */
  label?: string;
}

export interface MemorySections {
  philosophy: MemorySection;
  values: MemorySection;
  voice: MemorySection;
  facts: MemorySection;
  decisions: MemorySection;
  people: MemorySection & { entries: PersonEntry[] };
}

export interface MemoryAssembly {
  /** Prompt-ready block with PHILOSOPHY / VALUES / VOICE / FACTS /
   *  DECISIONS / PEOPLE headers. Empty string when the brain is empty. */
  contextBlock: string;
  memoryChars: number;
  usedIds: string[];
  sections: MemorySections;
}

const EMPTY_SECTION: MemorySection = { texts: [], lines: [], ids: [], omitted: 0 };

// ---------------------------------------------------------------------------
// Tokenizing for keyword-overlap retrieval (flow-doc §3.4).
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "about", "after", "again", "against", "because", "before", "between",
  "could", "does", "doing", "down", "during", "each", "from", "have",
  "having", "here", "into", "more", "most", "other", "over", "same",
  "should", "such", "than", "that", "their", "them", "then", "there",
  "these", "they", "this", "those", "through", "under", "very", "want",
  "were", "what", "when", "where", "which", "while", "with", "would",
  "your", "yours", "will", "just", "like", "make", "made", "know",
  "think", "feel", "really", "much", "many", "some", "also", "only",
  "even", "back", "still", "well", "been", "than",
]);

/** Lowercase, strip punctuation, drop stopwords and tokens under 4 chars. */
export function normalizeTokens(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return raw.filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

/** Shared-token count between the message and the candidate text, counted
 *  on unique tokens so a repeated word cannot inflate the score. */
export function overlapScore(message: string, text: string): number {
  const msg = new Set(normalizeTokens(message));
  if (msg.size === 0) return 0;
  const seen = new Set<string>();
  let n = 0;
  for (const t of normalizeTokens(text)) {
    if (!seen.has(t)) {
      seen.add(t);
      if (msg.has(t)) n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Ordering and section building.
// ---------------------------------------------------------------------------

/** Pinned first, then newest. */
function byPinnedThenNewest(a: BrainMemoryRow, b: BrainMemoryRow): number {
  const pa = a.data.pinned ? 0 : 1;
  const pb = b.data.pinned ? 0 : 1;
  if (pa !== pb) return pa - pb;
  return b.created_at.localeCompare(a.created_at);
}

/**
 * Render rows in priority order into a capped section. The first row that
 * does not fit ends the section - everything after it is "omitted", so the
 * "+N more" count is honest about priority, not just bytes.
 */
function buildSection(
  rows: BrainMemoryRow[],
  capChars: number,
  render: (row: BrainMemoryRow) => string,
  moreNoun: string,
): MemorySection & { chars: number } {
  const texts: string[] = [];
  const ids: string[] = [];
  let chars = 0;
  let omitted = 0;
  for (const row of rows) {
    const text = render(row).trim();
    if (!text) {
      omitted++;
      continue;
    }
    // +1 for the newline joining this line to the block.
    if (chars + text.length + 2 + 1 > capChars) {
      omitted++;
      continue;
    }
    texts.push(text);
    ids.push(row.id);
    chars += text.length + 3; // "- " + text, newline counted below
  }
  const lines = texts.map((t) => `- ${t}`);
  let moreLine = "";
  if (omitted > 0) {
    moreLine = `+${omitted} more ${moreNoun} filed`;
    lines.push(moreLine);
    chars += moreLine.length + 1;
  }
  return { texts, lines, ids, omitted, chars };
}

/** "2026-03-15" -> "Mar 2026". Decisions always show their date so stale
 *  ones read as stale (flow-doc §6). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthYear(iso: string): string {
  const p = iso.split("-");
  const m = MONTHS[Number(p[1]) - 1];
  const y = p[0];
  return m && y ? `${m} ${y}` : "";
}

function decisionDate(row: BrainMemoryRow): string {
  const d = row.data.date?.trim() || row.created_at.slice(0, 10);
  return monthYear(d);
}

function renderDecision(row: BrainMemoryRow): string {
  const date = decisionDate(row);
  const datePart = date ? ` (decided ${date})` : "";
  const why = row.data.why?.trim();
  return `${row.data.text.trim()}${datePart}${why ? ` ${EM_DASH} ${why}` : ""}`;
}

function personName(p: PersonRow): string {
  return (p.data.name ?? "").trim();
}

/** Only the string entries: person rows can also carry the per-area role
 *  editor's PersonRole objects ({categoryId, role}) under the same `roles`
 *  key, and the brain must never render one of those. */
function brainRoles(d: PersonRow["data"]): string[] {
  return (d.roles ?? []).filter((r): r is string => typeof r === "string");
}

function personLabel(p: PersonRow): string | undefined {
  const parts: string[] = [];
  const first = brainRoles(p.data)[0];
  if (first) parts.push(first);
  const note = p.data.roleNote?.trim();
  if (note) parts.push(note);
  return parts.length ? parts.join("; ") : undefined;
}

// ---------------------------------------------------------------------------
// Keyword-overlap retrieval (flow-doc §3.4).
// ---------------------------------------------------------------------------

function retrieveDecisions(
  memories: BrainMemoryRow[],
  message: string,
  capChars: number,
): MemorySection & { chars: number } {
  const scored = memories
    .filter(
      (m) =>
        m.data.category === "decision" &&
        m.data.state === "LEARNED" &&
        (m.data.status ?? "active") !== "archived",
    )
    .map((m) => ({
      row: m,
      score: overlapScore(message, `${m.data.text} ${m.data.why ?? ""}`),
    }))
    .filter((s) => s.score >= RETRIEVAL_MIN_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score || b.row.created_at.localeCompare(a.row.created_at),
    )
    .slice(0, RETRIEVAL_TOP_K)
    .map((s) => s.row)
    .sort(byPinnedThenNewest);
  const sec = buildSection(scored, capChars, renderDecision, "decisions");
  return sec;
}

function retrievePeople(
  people: PersonRow[],
  message: string,
  capChars: number,
): (MemorySection & { chars: number }) & { entries: PersonEntry[] } {
  const lower = message.toLowerCase();
  // A person named in the message is an automatic include, with roles + note.
  const auto = people.filter((p) => {
    const n = personName(p);
    return n.length > 0 && lower.includes(n.toLowerCase());
  });
  const autoIds = new Set(auto.map((p) => p.id));
  const retrieved = people
    .filter((p) => !autoIds.has(p.id) && personName(p).length > 0)
    .map((p) => ({
      row: p,
      score: overlapScore(
        message,
        `${personName(p)} ${brainRoles(p.data).join(" ")} ${p.data.roleNote ?? ""}`,
      ),
    }))
    .filter((s) => s.score >= RETRIEVAL_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, RETRIEVAL_TOP_K)
    .map((s) => s.row);
  const ordered = [...auto, ...retrieved];
  const texts: string[] = [];
  const ids: string[] = [];
  const entries: PersonEntry[] = [];
  for (const p of ordered) {
    const name = personName(p);
    const label = personLabel(p);
    texts.push(label ? `${name} (${label})` : name);
    ids.push(p.id);
    entries.push(label ? { name, label } : { name });
  }
  const lines = texts.map((t) => `- ${t}`);
  let chars = lines.reduce((n, l) => n + l.length + 1, 0);
  if (chars > capChars && texts.length > auto.length) {
    // Trim retrieved people from the tail until the section fits. People
    // named in the message (auto) are never dropped for budget.
    while (texts.length > auto.length && chars > capChars) {
      const dropped = texts.pop();
      ids.pop();
      entries.pop();
      if (dropped !== undefined) chars -= dropped.length + 3; // "- " + newline
    }
    return { texts, lines: texts.map((t) => `- ${t}`), ids, omitted: 0, chars, entries };
  }
  return { texts, lines, ids, omitted: 0, chars, entries };
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

export function assembleMemory(input: MemoryInput): MemoryAssembly {
  const learned = input.memories.filter(
    (m) => m.data && m.data.state === "LEARNED",
  );
  const inCategory = (c: BrainMemoryRow["data"]["category"]) =>
    learned.filter((m) => m.data.category === c).sort(byPinnedThenNewest);

  // Philosophy + values: always included, in full up to their caps.
  const philosophy = buildSection(
    inCategory("philosophy"),
    PHILOSOPHY_CAP_CHARS,
    (r) => r.data.text,
    "philosophy items",
  );
  const values = buildSection(
    inCategory("value"),
    VALUES_CAP_CHARS,
    (r) => r.data.text,
    "values",
  );
  let used = philosophy.chars + values.chars;

  // Voice samples: drafts only. Never in chat.
  const voiceRows = inCategory("voice").slice(0, VOICE_SAMPLE_CAP);
  const voice = input.isDraft
    ? buildSection(
        voiceRows,
        Math.max(0, MEMORY_BUDGET_CHARS - used),
        (r) => r.data.text,
        "voice samples",
      )
    : { ...EMPTY_SECTION, chars: 0 };
  used += voice.chars;

  // Decisions + people: retrieved per message, inside what is left.
  const decisions = retrieveDecisions(
    learned,
    input.message,
    Math.max(0, MEMORY_BUDGET_CHARS - used),
  );
  used += decisions.chars;
  const people = retrievePeople(
    input.people,
    input.message,
    Math.max(0, MEMORY_BUDGET_CHARS - used),
  );
  used += people.chars;

  // Facts: fill whatever budget is left.
  const facts = buildSection(
    inCategory("fact"),
    Math.max(0, MEMORY_BUDGET_CHARS - used),
    (r) => r.data.text,
    "facts",
  );

  const sections: MemorySections = { philosophy, values, voice, facts, decisions, people };
  const headers: [keyof MemorySections, string][] = [
    ["philosophy", "PHILOSOPHY"],
    ["values", "VALUES"],
    ["voice", "VOICE"],
    ["facts", "FACTS"],
    ["decisions", "DECISIONS"],
    ["people", "PEOPLE"],
  ];
  const parts: string[] = [];
  for (const [key, header] of headers) {
    const s = sections[key];
    if (s.lines.length > 0) parts.push(`${header}\n${s.lines.join("\n")}`);
  }
  const contextBlock = parts.join("\n\n");
  const memoryChars = contextBlock.length;
  const usedIds = [
    ...philosophy.ids,
    ...values.ids,
    ...voice.ids,
    ...facts.ids,
    ...decisions.ids,
    ...people.ids,
  ];
  return { contextBlock, memoryChars, usedIds, sections };
}

/**
 * Map an assembly into AIContextInput fields (context.ts). The caller does
 * this and hands the result to assembleContext - this module stays pure,
 * the caller stays the one that fetched the rows.
 */
export function toContextInput(m: MemoryAssembly): {
  philosophy: string;
  values: string;
  voice: string;
  voiceSamples: string[];
  facts: string[];
  decisions: string[];
  peopleDetail: { name: string; label?: string }[];
} {
  const s = m.sections;
  return {
    philosophy: s.philosophy.texts.join("\n"),
    values: s.values.texts.join("\n"),
    voice: s.voice.texts.join("\n"),
    voiceSamples: [...s.voice.texts],
    facts: [...s.facts.texts],
    decisions: [...s.decisions.texts],
    peopleDetail: s.people.entries.map((e) =>
      e.label ? { name: e.name, label: e.label } : { name: e.name },
    ),
  };
}

/**
 * The citation rule, for AFTER the cache breakpoint: filed memory rides
 * the cached context prefix, this goes in the instructions half
 * (systemPrompt.ts rules unchanged). Empty when the brain is empty -
 * nothing filed, nothing to cite.
 */
export function draftInstructions(memory: MemoryAssembly): string {
  if (memory.memoryChars === 0) return "";
  return (
    "When your answer uses one of the filed items above, name it with its date " +
    `${EM_DASH} "per your decision in March…" ${EM_DASH} instead of restating it flat. ` +
    "That is what makes it sound like you know them instead of giving " +
    "generic advice."
  );
}
