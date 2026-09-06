// SYLLABUS TO TASKS AND DATES (UP-CORE-12, 2026-09-05).
//
// A photographed syllabus (or a pasted one) holds a semester of work in one
// page, and the app could read a schedule photo into events and a gym program
// into a plan while this one shape, the one that produces TASKS, had no
// extractor at all.
//
// The same distillation the schedule upload uses: extract, review every row,
// then commit. Nothing reaches a list until a person has seen it, and the
// three refusals are the same ones, for the same reason (a wrong guess here
// is a silent error you find out about the week it is due):
//
//   - NO YEAR IS INVENTED. A syllabus that never states one is asked about
//     once, for the whole batch, by the flow that calls this.
//   - NO DATE IS INVENTED. "Read chapter 4" with no date stays undated and
//     the row says so; it does not get a plausible-looking Friday.
//   - NO KIND IS INVENTED. An assignment is a task with a due date, an exam
//     is an event at a time. The model says which; the chip lets a person
//     say otherwise before anything is written.
//
// The raw file is NOT retained, exactly as the schedule upload does not
// retain its photo: it is encoded, sent once, and dropped. Provenance is
// still stamped ("From a file"), it simply has nothing to open, which is
// honest, where a stored file in a scope no screen lists would not be.

export const SYLLABUS_EXTRACT_PROMPT = [
  "Extract every assignment, reading, quiz and exam from this syllabus.",
  "Reply with ONLY a JSON object, no prose, no code fences, in exactly this shape:",
  '{"items":[{"title":"...","kind":"task","month":9,"day":15,"year":2026,"start":"14:00","weight":"20%"}]}',
  'kind is "task" for anything that is handed in or done (an assignment, a reading, a problem set) and "event" for anything you have to BE somewhere for at a time (an exam, a quiz, a presentation, a lab).',
  "month is 1-12, day is 1-31. Use the source's own words for the title.",
  "If a date is not written for a row, set month and day to null. Do not guess a date.",
  "If a year is not written anywhere in the content, set year to null. Do not guess a year.",
  'start is the time an exam or quiz begins, 24-hour "HH:MM", or null. Do not guess a time.',
  'weight is the grade share if the syllabus states one ("20%"), else null.',
  "Do not invent items that are not in the content.",
].join("\n");

export type SyllabusKind = "task" | "event";

export interface ExtractedSyllabusItem {
  id: string;
  title: string;
  kind: SyllabusKind;
  month: number | null;
  day: number | null;
  year: number | null;
  start: string | null;
  weight: string | null;
}

// The same deterministic id shape the schedule parser uses: a running counter
// folded through a small hash, so ids are unique within a session without
// reaching for Date.now() or Math.random().
let seq = 0;
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
const nid = () => `sy${(seq++).toString(36)}${Math.abs(hash("sy" + seq)) % 1000}`;

const MAX_ITEMS = 120;
const MAX_TITLE = 100;
const MAX_WEIGHT = 12;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function intInRange(x: unknown, lo: number, hi: number): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= lo && r <= hi ? r : null;
}

/**
 * Parse the model's reply, tolerantly but never inventively: fences stripped,
 * a row with no title dropped, everything else clamped or nulled. Null when
 * nothing usable survives, exactly like the schedule and gym parsers.
 */
export function parseSyllabusExtract(raw: string): ExtractedSyllabusItem[] | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1]!.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const root = obj as { items?: unknown };
  const out: ExtractedSyllabusItem[] = [];
  for (const rawItem of Array.isArray(root.items) ? root.items.slice(0, MAX_ITEMS) : []) {
    const it = rawItem as { title?: unknown; kind?: unknown; month?: unknown; day?: unknown; year?: unknown; start?: unknown; weight?: unknown };
    const title = typeof it.title === "string" ? it.title.trim().slice(0, MAX_TITLE) : "";
    if (!title) continue; // no name: nothing a person could recognise
    const month = intInRange(it.month, 1, 12);
    const day = intInRange(it.day, 1, 31);
    out.push({
      id: nid(),
      title,
      // Anything the model does not call an event is a task: a task is the
      // reversible read (it carries a due date and nothing else), and the
      // review chip is one tap either way.
      kind: it.kind === "event" ? "event" : "task",
      // Half a date is no date. A month with no day cannot be written down.
      month: month !== null && day !== null ? month : null,
      day: month !== null && day !== null ? day : null,
      year: intInRange(it.year, 2000, 2100),
      start: typeof it.start === "string" && TIME_RE.test(it.start) ? it.start : null,
      weight: typeof it.weight === "string" && it.weight.trim() ? it.weight.trim().slice(0, MAX_WEIGHT) : null,
    });
  }
  return out.length ? out : null;
}

// year+month+day -> "YYYY-MM-DD", or null when it is not a real calendar date
// (guards Feb 30 and a mis-read day rather than letting Date roll it forward).
export function toISODate(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface SyllabusRow {
  key: string;
  title: string;
  kind: SyllabusKind;
  // "" when the source gave no date. The row says so and the import refuses
  // it: an undated assignment is a real thing on a syllabus ("read as we go")
  // and dating it would be a lie with a deadline attached.
  date: string;
  start: string;   // "" when no time was stated
  weight: string;  // "" when the syllabus stated no grade share
  noDate: boolean;
  skip: boolean;
}

// Turn extracted items into review rows, resolving the year only for rows the
// source left null. A row whose date is not real even after resolving is left
// UNDATED rather than dropped: the assignment exists, and a person can date it
// in the review or let it in without one.
export function buildSyllabusRows(items: ExtractedSyllabusItem[], fallbackYear: number): SyllabusRow[] {
  return items.map((it) => {
    const date = it.month !== null && it.day !== null
      ? toISODate(it.year ?? fallbackYear, it.month, it.day)
      : null;
    return {
      key: it.id,
      title: it.title,
      kind: it.kind,
      date: date ?? "",
      start: it.start ?? "",
      weight: it.weight ?? "",
      noDate: !date,
      skip: false,
    };
  });
}

// What the review says about one row, in words. The weight is the syllabus's
// own claim, quoted rather than computed.
export function rowLine(r: SyllabusRow, dateWord: (iso: string) => string): string {
  const parts: string[] = [r.kind === "event" ? "Event" : "Task"];
  if (r.noDate) parts.push("No date found");
  else parts.push(dateWord(r.date));
  if (r.kind === "event" && r.start) parts.push(r.start);
  if (r.weight) parts.push(r.weight);
  return parts.join(" · ");
}
