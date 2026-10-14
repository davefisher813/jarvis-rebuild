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
  '{"events":[{"title":"...","month":8,"day":15,"year":2026,"start":"14:00","end":"15:30","location":"...","recurring":false,"weekdays":[1,3]}]}',
  "month is 1-12, day is 1-31.",
  "Use the source's own words for the title (e.g. \"vs Eagles\", \"Practice\"). Do not invent events that are not in the content.",
  "If a year is not written anywhere in the content, set year to null. Do not guess a year.",
  "If a start time is not written for an event, set start to null. Do not guess a time.",
  "end and location are optional: use null when not given. Times are 24-hour \"HH:MM\".",
  // UP-CORE-11 (2026-09-05): a printed timetable is a WEEKLY GRID, and
  // reading it as one week of dated events is what made "Bio Mon/Wed"
  // fourteen separate rows a semester. The model reports the shape it sees;
  // the review screen shows it and the person confirms it.
  "A weekly timetable (a class or practice grid with weekday columns) is RECURRING: set recurring to true and weekdays to the days it runs, 0=Sunday..6=Saturday.",
  "A dated one-off (a game on a date, an appointment) has recurring false and weekdays null. When in doubt, use false: a wrong repeat fills a calendar with events that never happen.",
  "For a recurring row, month and day are the FIRST date it runs (the week the schedule starts).",
].join("\n");

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const isoParts = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y: y!, m: m!, d: d! }; };
const addDaysIso = (iso: string, n: number): string => {
  const { y, m, d } = isoParts(iso);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
const weekdayOf = (iso: string): number => { const { y, m, d } = isoParts(iso); return new Date(y, m - 1, d).getDay(); };

/**
 * THE PROMPT, WITH TODAY IN IT. "Team call tomorrow at 2pm for 30 minutes" is a plain event, but "tomorrow" is only a date to a reader
 * who knows what today is, and the prompt never said. The model had no month and day to put in the JSON, so it returned nothing and the
 * sheet said it found no events. Today's date and weekday now go in with every read, with the rules for resolving a relative day and
 * for turning a length into an end time.
 */
export function scheduleExtractPrompt(today: string): string {
  const { y } = isoParts(today);
  return [
    SCHEDULE_EXTRACT_PROMPT,
    `Today is ${WEEKDAY_NAMES[weekdayOf(today)]}, ${today}.`,
    "Content can be as short as one sentence, and one sentence with a day and a time is an event: extract it.",
    `Resolve relative days against today: "today" and "tonight" are today, "tomorrow" is the day after, a bare weekday ("Friday") is its next occurrence, "next Friday" is the Friday of next week. A date with no year that is relative to today takes the year ${y} (or the following year if that date has already passed).`,
    'When a length is given ("for 30 minutes", "for two hours") and a start is known, set end to start plus that length.',
  ].join("\n");
}

export interface ExtractedEvent {
  id: string;
  title: string;
  month: number;   // 1-12
  day: number;      // 1-31
  year: number | null;
  start: string | null; // "HH:MM" or null when not stated
  end: string | null;
  location: string;
  // UP-CORE-11: the weekly-grid shape, when the source is one.
  recurring: boolean;
  weekdays: number[] | null;
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

/** "14:00" plus 30 minutes is "14:30"; null when it would run past midnight, since the sheet has no way to say that. */
function endAfter(start: string, minutes: number): string | null {
  const [h, m] = start.split(":").map(Number);
  const t = h! * 60 + m! + minutes;
  if (t >= 24 * 60) return null;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

// 0=Sun..6=Sat, de-duped and ordered. Null when the model gave nothing
// usable, which means "the day this row's own date falls on".
function cleanWeekdays(x: unknown): number[] | null {
  if (!Array.isArray(x)) return null;
  const out = [...new Set(x.map((v) => intInRange(v, 0, 6)).filter((v): v is number => v !== null))].sort((a, b) => a - b);
  return out.length ? out : null;
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
  // The reply is an object with events, but a model that answers with the bare list is still answering.
  const open = text.search(/[{[]/);
  const close = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (open < 0 || close <= open) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(open, close + 1));
  } catch {
    return null;
  }
  const list = Array.isArray(obj) ? obj : (obj as { events?: unknown }).events;
  const out: ExtractedEvent[] = [];
  for (const raw of Array.isArray(list) ? list.slice(0, MAX_EVENTS) : []) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as { title?: unknown; month?: unknown; day?: unknown; year?: unknown; start?: unknown; end?: unknown; location?: unknown; date?: unknown; durationMin?: unknown; duration?: unknown };
    const title = cleanTitle(e.title);
    // A whole date ("2026-10-15") is as good as a month and a day.
    const dated = typeof e.date === "string" ? /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(e.date.trim()) : null;
    const month = intInRange(e.month, 1, 12) ?? (dated ? intInRange(dated[2], 1, 12) : null);
    const day = intInRange(e.day, 1, 31) ?? (dated ? intInRange(dated[3], 1, 31) : null);
    if (!title || month === null || day === null) continue; // no name or no real date: not usable
    const year = intInRange(e.year, 2000, 2100) ?? (dated ? intInRange(dated[1], 2000, 2100) : null);
    const evStart = cleanTime(e.start);
    // A length stands in for an end the source did not print.
    const len = intInRange(e.durationMin ?? e.duration, 1, 1440);
    const evEnd = cleanTime(e.end) ?? (evStart && len !== null ? endAfter(evStart, len) : null);
    const location = typeof e.location === "string" ? e.location.trim().slice(0, MAX_LOCATION) : "";
    const weekdays = cleanWeekdays((e as { weekdays?: unknown }).weekdays);
    // A repeat is claimed only when the model says so outright. A weekday
    // list on its own is not a repeat: the source may simply have named the
    // day a one-off falls on.
    const recurring = (e as { recurring?: unknown }).recurring === true;
    out.push({ id: nid(), title, month, day, year, start: evStart, end: evEnd, location, recurring, weekdays });
  }
  return out.length ? out : null;
}

// ---- plain sentences, read without the model ----

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_WORDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * THE FLOOR UNDER THE MODEL. A plain sentence ("Team call tomorrow at 2pm for 30 minutes", "Dentist Friday 9:30am") says everything an
 * event needs, and a read that comes back with nothing for it is the wrong answer however the model happened to phrase its reply. When
 * the model finds nothing, each line of the pasted text is read here for a day, a time and a length. A line with no day in it is
 * skipped, never guessed at; the review screen still shows every row before anything reaches the calendar.
 */
export function readPlainSentences(text: string, today: string): ExtractedEvent[] | null {
  const out: ExtractedEvent[] = [];
  const todayY = isoParts(today).y;
  for (const line of text.split(/\n+|(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean).slice(0, MAX_EVENTS)) {
    let rest = line;
    const take = (re: RegExp): RegExpExecArray | null => {
      const m = re.exec(rest);
      if (m) rest = (rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length));
      return m;
    };
    // A length.
    let len: number | null = null;
    const lm = take(/\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
    if (lm) len = Math.round(Number(lm[1]) * (/^h/i.test(lm[2]!) ? 60 : 1));
    // A time: 2pm, 2:30 pm, 14:00.
    let start: string | null = null;
    const tm = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/i) ?? take(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
    if (tm) {
      let h = Number(tm[1]);
      const ap = (tm[3] ?? "").toLowerCase();
      if (ap.startsWith("p") && h < 12) h += 12;
      if (ap.startsWith("a") && h === 12) h = 0;
      if (h <= 23) start = `${String(h).padStart(2, "0")}:${tm[2] ?? "00"}`;
    }
    // A day.
    let date: string | null = null;
    const rel = take(/\b(today|tonight|tomorrow)\b/i);
    if (rel) date = rel[1]!.toLowerCase() === "tomorrow" ? addDaysIso(today, 1) : today;
    if (!date) {
      const wd = take(/\b(?:(next)\s+)?(?:on\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/i);
      if (wd) {
        const target = DAY_WORDS.indexOf(wd[2]!.slice(0, 3).toLowerCase());
        const ahead = (target - weekdayOf(today) + 7) % 7 || 7;
        date = addDaysIso(today, ahead + (wd[1] && ahead < 7 ? 7 : 0));
      }
    }
    if (!date) {
      const md = take(new RegExp("\\b(?:on\\s+)?(" + MONTHS.join("|") + ")[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?", "i"));
      const slash = md ? null : take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      let mo: number | null = null, dd: number | null = null, yy: number | null = null;
      if (md) { mo = MONTHS.indexOf(md[1]!.toLowerCase()) + 1; dd = Number(md[2]); yy = md[3] ? Number(md[3]) : null; }
      else if (slash) { mo = Number(slash[1]); dd = Number(slash[2]); yy = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : null; }
      if (mo && dd) {
        let y = yy ?? todayY;
        let iso = toISODate(y, mo, dd);
        if (iso && !yy && iso < today) { y += 1; iso = toISODate(y, mo, dd); }
        date = iso;
      }
    }
    if (!date) continue;
    // What is left is the title: the words that were not the day, the time or the length.
    const title = cleanTitle(rest.replace(/\b(?:on|at|for|from|starting|starts?)\b\s*$/i, " ").replace(/\b(?:on|at|for)\b(?=\s*[.,;]|\s*$)/gi, " ").replace(/[\s,;:.\-–]+$/g, "").replace(/^[\s,;:.\-–]+/g, "").replace(/\s+/g, " "));
    if (!title) continue;
    const { y: yy2, m, d } = isoParts(date);
    out.push({ id: nid(), title, month: m, day: d, year: yy2, start, end: start && len !== null ? endAfter(start, len) : null, location: "", recurring: false, weekdays: null });
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
  // "09:00" seed when the source had no time. SCHED-F-08 (2026-09-05): a
  // seed for the fix sheet only. The review flags the row and the import
  // refuses it until it has a real time, so this value never reaches the
  // calendar wearing the source's authority.
  start: string;
  end: string;      // "" when the source had none
  location: string;
  noTime: boolean;  // the source did not state a time; flagged, not hidden
  matchId: string | null; // existing event this will UPDATE instead of duplicating
  // UP-CORE-11 (2026-09-05): the review's own answer to "is this a weekly
  // class or a one-off". Defaulted from what the source looked like and
  // changed by a chip, so a printed timetable imports as repeating classes
  // rather than one week of dated events.
  repeats: boolean;
  days: number[];
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
      repeats: ex.recurring,
      // The days it runs, or the one its own date falls on.
      days: ex.weekdays ?? [new Date(date + "T00:00:00").getDay()],
    });
  }
  return rows;
}
