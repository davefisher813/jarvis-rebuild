// THE SEASON FEED (catalog Part 8, rank #3: "the enabling integration for
// the entire health surface"). A real ICS/subscription parser is out of
// scope for this pass (flagged as follow-up below); what ships here is the
// photo/text distillation path, the same SHAPE gym/extract.ts already
// proved out for coach-issued programs -- read as reference only, not
// imported: parse a coach's screenshot or pasted text of a practice
// schedule into draft calendar events, show every one for review, and
// commit nothing until the athlete keeps or fixes each row. The raw file is
// never retained, same as the gym pipeline.
//
// FOLLOW-UP, stated once here rather than silently dropped: a real
// ICS/subscription feed (TeamSnap, SportsEngine, GameChanger, Hudl) is not
// built in this pass. This file only distills a photo or pasted text.

export const SEASON_EXTRACT_PROMPT = [
  "Extract a sports team's practice/game schedule from this content.",
  "Reply with ONLY a JSON object, no prose, no code fences, in exactly this shape:",
  '{"org":"team or program name","events":[{"title":"event name","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"}]}',
  "date is the local calendar date. start and end are 24-hour local times. Omit end if the content does not state one.",
  "Use the coach's own words for event titles. Do not invent an event that is not in the content.",
  "If a date or time is unreadable for one row, drop that row rather than guessing.",
].join("\n");

export interface SeasonEventDraft {
  title: string;
  date: string;
  start: string;
  end?: string;
}

export interface SeasonFeedDraft {
  org: string;
  events: SeasonEventDraft[];
}

const MAX_EVENTS = 60;
const MAX_TITLE = 80;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

function cleanTitle(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim().slice(0, MAX_TITLE);
  return t.length ? t : null;
}

/** Parse the model's reply into a SeasonFeedDraft, tolerantly but never
 *  inventively: fences stripped, bad rows dropped, nothing guessed. Null
 *  when nothing usable survives. Same tolerant-parse shape as
 *  gym/extract.ts's parseProgramExtract, read as a pattern, not imported. */
export function parseSeasonExtract(raw: string): SeasonFeedDraft | null {
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
  const root = obj as { org?: unknown; events?: unknown };
  const org = cleanTitle(root.org) ?? "The Team";
  const events: SeasonEventDraft[] = [];
  for (const e of Array.isArray(root.events) ? root.events.slice(0, MAX_EVENTS) : []) {
    const ee = e as { title?: unknown; date?: unknown; start?: unknown; end?: unknown };
    const title = cleanTitle(ee.title);
    const date = typeof ee.date === "string" && DATE_RE.test(ee.date) ? ee.date : null;
    const startTime = typeof ee.start === "string" && TIME_RE.test(ee.start) ? ee.start : null;
    if (!title || !date || !startTime) continue; // unreadable row, dropped rather than guessed
    const endTime = typeof ee.end === "string" && TIME_RE.test(ee.end) ? ee.end : undefined;
    events.push({ title, date, start: startTime, ...(endTime ? { end: endTime } : {}) });
  }
  if (events.length === 0) return null;
  return { org, events };
}
