// EMAIL SECTIONS (2026-09-29): simple, user-made filters that sit beside the
// three AI buckets on the Email tab.
//
// WHAT A SECTION IS. A name and a list of matchers, saved on the profile. It
// is a LOCAL FILTER over mail already loaded on the phone: never a Gmail
// label, never an AI bucket, never a deletion or archive rule. Creating one,
// editing one and using one make no AI call and no Gmail call of any kind, and
// a thread keeps whatever bucket the sort gave it. The three buckets stay
// exactly needs_you, worth_knowing and noise; nothing here adds a fourth.
//
// WHAT A MATCHER IS. One of two literal tests:
//   sender   "Sender Contains": the text is in the sender's display name or
//            their email address
//   subject  "Subject or Preview Contains": the text is in the decoded
//            subject or in Gmail's snippet (entities decoded)
// Both are a case-insensitive LITERAL substring after trim and Unicode NFKC.
// There is no regex, no wildcard, no synonym, no nesting and no AND/OR
// builder: "a.c" finds "a.c" and never "abc", and "*" finds an asterisk.
// A section's matchers are ANY: a thread that passes one is in.
//
// AN EMPTY MATCHER MATCHES NOTHING. The alternative, that "contains nothing"
// is true of everything, would make a half-typed section swallow the whole
// inbox. It is a validation error too, so it cannot be saved.
//
// CAPS ARE SHOWN, NEVER APPLIED. Name 60, matcher 200, matchers per section
// 50, sections 50. Text over a cap is an error the person sees; it is never
// cut off to fit, because a filter that quietly means something other than
// what was typed is worse than one that refuses.
//
// Pure: no React, no services. The page, the hook and the list all import it.

import { decodeEntities } from "../connections/google/decode";
import { newClientId } from "../shared/clientId";

export type SectionField = "sender" | "subject";

export interface SectionMatcher { field: SectionField; text: string }
export interface EmailSection { id: string; name: string; matchers: SectionMatcher[] }

/** The least a thread needs to be tested. ThreadRow satisfies it. */
export interface SectionThread { from: string; fromEmail: string; subject: string; snippet: string }

export const SECTION_LIMITS = { name: 60, matcher: 200, matchersPerSection: 50, sections: 50 } as const;

export const FIELD_LABEL: Record<SectionField, string> = {
  sender: "Sender Contains",
  subject: "Subject or Preview Contains",
};
export const SECTION_FIELDS: SectionField[] = ["sender", "subject"];

export const SECTION_ERRORS = {
  nameEmpty: "Add a name",
  nameLong: "Over 60 characters",
  nameTaken: "Another section has this name",
  noMatchers: "Add at least one matcher",
  matcherEmpty: "Add text to match",
  matcherLong: "Over 200 characters",
  tooManyMatchers: "Up to 50 matchers in a section",
  tooManySections: "Up to 50 sections",
} as const;

/** The errors that are about a cap. A screen shows these the moment a cap is
 *  crossed, where the rest can wait for the first Save. */
export const isCapError = (msg: string | undefined): boolean =>
  msg === SECTION_ERRORS.nameLong || msg === SECTION_ERRORS.matcherLong
  || msg === SECTION_ERRORS.tooManyMatchers || msg === SECTION_ERRORS.tooManySections;

const chars = (s: string): number => Array.from(s).length;

/** The one fold every comparison uses: NFKC, lower-case, NFKC again (lower-
 *  casing can produce a sequence that has its own composed form). */
export function foldText(s: string): string {
  return s.normalize("NFKC").toLowerCase().normalize("NFKC");
}

/** A new section's id. Stable for the life of the section: renaming or
 *  reordering never changes it, so a chip or an undo can hold on to it. */
export function newSectionId(): string {
  return "sec_" + newClientId();
}

// ---- normalization ---------------------------------------------------------

/** Trimmed for saving. The folded form is only ever used to compare; what is
 *  stored is what was typed, so the list reads back as it was written. */
export function normalizeSection(s: EmailSection): EmailSection {
  return {
    id: s.id,
    name: s.name.trim(),
    matchers: s.matchers.map((m) => ({ field: m.field, text: m.text.trim() })),
  };
}

/** Reads whatever the profile holds back into sections. Anything that is not
 *  a section (another version's shape, a hand edit) is dropped rather than
 *  crashing the tab; nothing is capped or altered on the way in. */
export function readEmailSections(raw: unknown): EmailSection[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailSection[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as { id?: unknown; name?: unknown; matchers?: unknown };
    if (typeof o.id !== "string" || !o.id || seen.has(o.id) || typeof o.name !== "string" || !Array.isArray(o.matchers)) continue;
    const matchers: SectionMatcher[] = [];
    for (const m of o.matchers) {
      const mm = m as { field?: unknown; text?: unknown } | null;
      if (mm && (mm.field === "sender" || mm.field === "subject") && typeof mm.text === "string") matchers.push({ field: mm.field, text: mm.text });
    }
    seen.add(o.id);
    out.push({ id: o.id, name: o.name, matchers });
  }
  return out;
}

// ---- validation ------------------------------------------------------------

export interface SectionValidation {
  ok: boolean;
  name?: string;
  /** One entry per matcher, in order; undefined where that matcher is fine. */
  matchers: (string | undefined)[];
  /** Errors about the section as a whole (no matchers, too many). */
  section?: string;
}

/** Validates one section against the OTHER sections (by id, so editing a
 *  section never collides with itself). Measures the trimmed text. */
export function validateSection(draft: EmailSection, others: readonly EmailSection[]): SectionValidation {
  const s = normalizeSection(draft);
  let name: string | undefined;
  if (s.name === "") name = SECTION_ERRORS.nameEmpty;
  else if (chars(s.name) > SECTION_LIMITS.name) name = SECTION_ERRORS.nameLong;
  else if (others.some((o) => o.id !== s.id && foldText(o.name.trim()) === foldText(s.name))) name = SECTION_ERRORS.nameTaken;

  const matchers = s.matchers.map((m) =>
    foldText(m.text) === "" ? SECTION_ERRORS.matcherEmpty
      : chars(m.text) > SECTION_LIMITS.matcher ? SECTION_ERRORS.matcherLong
      : undefined);

  let section: string | undefined;
  if (s.matchers.length === 0) section = SECTION_ERRORS.noMatchers;
  else if (s.matchers.length > SECTION_LIMITS.matchersPerSection) section = SECTION_ERRORS.tooManyMatchers;

  const ok = !name && !section && matchers.every((e) => !e);
  return { ok, ...(name ? { name } : {}), matchers, ...(section ? { section } : {}) };
}

/** Why a NEW section cannot be added right now, or null. */
export function addSectionBlock(list: readonly EmailSection[]): string | null {
  return list.length >= SECTION_LIMITS.sections ? SECTION_ERRORS.tooManySections : null;
}

// ---- list operations (pure) ------------------------------------------------

export function upsertSection(list: readonly EmailSection[], section: EmailSection): EmailSection[] {
  const s = normalizeSection(section);
  const at = list.findIndex((x) => x.id === s.id);
  if (at === -1) return [...list, s];
  return list.map((x, i) => (i === at ? s : x));
}

export function removeSection(list: readonly EmailSection[], id: string): EmailSection[] {
  return list.filter((x) => x.id !== id);
}

/** Puts a removed section back where it was (Undo), unless something with the
 *  same id has arrived in the meantime. */
export function restoreSection(list: readonly EmailSection[], section: EmailSection, index: number): EmailSection[] {
  if (list.some((x) => x.id === section.id)) return [...list];
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, section);
  return next;
}

// ---- matching --------------------------------------------------------------

interface Needle { field: SectionField; needle: string }

function needlesOf(section: EmailSection): Needle[] {
  const out: Needle[] = [];
  for (const m of section.matchers) {
    const needle = foldText(m.text.trim());
    if (needle !== "") out.push({ field: m.field, needle });
  }
  return out;
}

function testThread(t: SectionThread, needles: readonly Needle[]): boolean {
  if (needles.length === 0) return false;
  let sender: string[] | null = null;
  let subject: string[] | null = null;
  for (const n of needles) {
    if (n.field === "sender") {
      sender ??= [foldText(t.from), foldText(t.fromEmail)];
      if (sender.some((h) => h.includes(n.needle))) return true;
    } else {
      // The subject is already decoded at the Gmail boundary; the snippet
      // arrives with HTML entities in it and is decoded here, once.
      subject ??= [foldText(t.subject), foldText(decodeEntities(t.snippet))];
      if (subject.some((h) => h.includes(n.needle))) return true;
    }
  }
  return false;
}

/** True when any of the section's matchers matches the thread. */
export function matchesSection(thread: SectionThread, section: EmailSection): boolean {
  return testThread(thread, needlesOf(section));
}

/** The rows a section shows: the input's own order, each row at most once, the
 *  rows themselves untouched (so each keeps its AI bucket). A null section is
 *  "All" and returns the input as it is. */
export function filterBySection<T extends SectionThread>(rows: readonly T[], section: EmailSection | null): T[] {
  if (!section) return [...rows];
  const needles = needlesOf(section);
  return rows.filter((r) => testThread(r, needles));
}
