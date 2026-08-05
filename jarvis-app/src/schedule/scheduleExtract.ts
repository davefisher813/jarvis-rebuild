// Schedule upload: read a photo (or pasted text) of a schedule and turn it
// into calendar events, with a mandatory review before anything saves. Same
// distillation shape as the gym program upload: extract -> review -> commit,
// raw file never retained.
//
// Two things this deliberately does NOT guess, because a wrong guess here is
// a silent, hard-to-notice error (a game on the wrong day):
//   - the YEAR, if the source never states one (asked once, for the whole
//     batch, by the flow that calls this)
//   - a missing START TIME (left unset; the review row flags it rather than
//     inventing a time that looks legitimate)

export const SCHEDULE_EXTRACT_PROMPT = [
  "Extract every scheduled event (games, practices, meetings, appointments) from this content.",
  "Reply with ONLY a JSON object, no prose, no code fences, in exactly this shape:",
  '{"events":[{"title":"...","month":8,"day":15,"year":2026,"start":"14:00","end":"15:30","location":"..."}]}',
  "month is 1-12, day is 1-31.",
  "Use the source's own words for the title (e.g. \"vs Eagles\", \"Practice\"). Do not invent events that are not in the content.",
  "If a year is not written anywhere in the content, set year to null. Do not guess a year.",
  "If a start time is not written for an event, set start to null. Do not guess a time.",
  "end and location are optional: use null when not given. Times are 24-hour \"HH:MM\".",
].join("\n");

export interface ExtractedEvent {
  id: string;
  title: string;
  month: number;   // 1-12
  day: number;      // 1-31
  year: number | null;
  start: string | null; // "HH:MM" or null when not stated
  end: string | null;
  location: string;
}

// Same deterministic id shape as the gym program parser: a running counter
// folded through a small hash, so ids are unique within a session without
// reaching for Date.now()/Math.random() (keeps this pure and testable).
let seq = 0;
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
const nid = () => `sx${(seq++).toString(36)}${Math.abs(hash("sx" + seq)) % 1000}`;

const MAX_EVENTS = 60;
const MAX_TITLE = 80;
const MAX_LOCATION = 80;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanTitle(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim().slice(0, MAX_TITLE);
  return t.length ? t : null;
}

function cleanTime(x: unknown): string | null {
  return typeof x === "string" && TIME_RE.test(x) ? x : null;
}

function intInRange(x: unknown, lo: number, hi: number): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= lo && r <= hi ? r : null;
}

/**
 * Parse the model's reply into extracted rows, tolerantly but never
 * inventively: fences stripped, bad rows dropped (missing title, or a
 * month/day that cannot be a real date), numbers/strings clamped. Null when
 * nothing usable survives, exactly like the gym program parser.
 */
export function parseScheduleExtract(raw: string): ExtractedEvent[] | null {
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
  const root = obj as { events?: unknown };
  const out: ExtractedEvent[] = [];
  for (const raw of Array.isArray(root.events) ? root.events.slice(0, MAX_EVENTS) : []) {
    const e = raw as { title?: unknown; month?: unknown; day?: unknown; year?: unknown; start?: unknown; end?: unknown; location?: unknown };
    const title = cleanTitle(e.title);
    const month = intInRange(e.month, 1, 12);
    const day = intInRange(e.day, 1, 31);
    if (!title || month === null || day === null) continue; // no name or no real date: not usable
    const year = intInRange(e.year, 2000, 2100);
    const evStart = cleanTime(e.start);
    const evEnd = cleanTime(e.end);
    const location = typeof e.location === "string" ? e.location.trim().slice(0, MAX_LOCATION) : "";
    out.push({ id: nid(), title, month, day, year, start: evStart, end: evEnd, location });
  }
  return out.length ? out : null;
}

// year+month+day -> "YYYY-MM-DD", or null if it is not a real calendar date
// (guards Feb 30, a mis-read day, etc. rather than letting Date silently roll
// it into the next month).
export function toISODate(year: number, month: number, day: number): string | null {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// ---- resolving extracted rows against the real calendar (review step) ----

// A minimal shape of an existing event, just enough to match against. Kept
// separate from the full EventItem/EventData types so this stays a pure,
// dependency-free module the review screen builds on.
export interface ExistingEvent { id: string; title: string; date: string }

export interface ScheduleRow {
  key: string;
  title: string;
  date: string;
  start: string;   // "09:00" default when the source had no time
  end: string;      // "" when the source had none
  location: string;
  noTime: boolean;  // the source did not state a time; flagged, not hidden
  matchId: string | null; // existing event this will UPDATE instead of duplicating
}

export const normTitle = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

// Turn extracted rows into review rows, resolving the year (falling back to
// `fallbackYear` only for rows the source left null) and matching against
// existing events. A match is exact and literal (same title, same date) on
// purpose: a fuzzy match that silently merges two different events is a
// worse failure than an occasional missed match the user can see and fix in
// the review list. Rows whose date is not real (even after resolving the
// year) are dropped rather than guessed at.
export function buildScheduleRows(extracted: ExtractedEvent[], fallbackYear: number, existing: ExistingEvent[]): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (const ex of extracted) {
    const date = toISODate(ex.year ?? fallbackYear, ex.month, ex.day);
    if (!date) continue;
    const match = existing.find((e) => e.date === date && normTitle(e.title) === normTitle(ex.title));
    rows.push({
      key: ex.id,
      title: ex.title,
      date,
      start: ex.start ?? "09:00",
      end: ex.end ?? "",
      location: ex.location,
      noTime: !ex.start,
      matchId: match?.id ?? null,
    });
  }
  return rows;
}
