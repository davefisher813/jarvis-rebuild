import type { EventItem } from "../schedule/types";

// PICK A TIME, FROM YOUR ACTUAL CALENDAR (N1, Dave 2026-08-20).
//
// An email proposing times is the most annoying kind of mail there is: it
// looks like information and is actually three decisions wearing a hat. Read
// the options, remember your week, pick one, write back, then remember to put
// it in the calendar.
//
// JARVIS already owns the calendar. It can do all four.
//
// Laws:
//   - Only times the SENDER offered. Never a time we thought would be nice.
//   - "Free" is checked against real events, not a guess, and an option that
//     collides is shown as taken rather than quietly dropped: he may want to
//     move the thing that is in the way.
//   - When nothing offered is free, the card says so and stops. Proposing a
//     counter-time is a different feature and pretending otherwise here would
//     have him send a time he never agreed to.

export interface ProposedTime {
  // The literal phrase the sender used, so the reply can quote them.
  label: string;
  date: string;   // YYYY-MM-DD
  start: string;  // HH:MM
  end: string;    // HH:MM
}

export interface TimeOption extends ProposedTime {
  free: boolean;
  clash?: string; // the event in the way, when there is one
}

const toMin = (t: string) => Number(t.split(":")[0] ?? 0) * 60 + Number(t.split(":")[1] ?? 0);
const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const MEETING_SYSTEM = [
  "You read one email and extract the meeting times the SENDER offered.",
  "Reply with ONLY a JSON array. Each item: {\"label\": \"<the sender's own phrase>\", \"date\": \"YYYY-MM-DD\", \"start\": \"HH:MM\", \"durationMin\": <number>}.",
  "Use 24-hour times. Only include times the sender actually proposed.",
  "If the email proposes no specific times, reply with an empty array.",
  "Never invent a time, a date, or a duration you were not given. Default duration is 60 when unstated.",
].join("\n");

// A cheap gate before an expensive call. Running the extractor over every
// thread that needs him would be one AI request per email; almost none of
// them propose a time, and the ones that do always say so in words.
const TIME_HINT = /\b(\d{1,2}\s?(am|pm)|\d{1,2}:\d{2}|mon|tue|wed|thu|fri|sat|sun|tomorrow|next week|availabilit|free (on|at)|work for you|does .{0,12}work|schedule a|set up a (call|time|meeting)|meet)/i;

export function mightProposeTimes(text: string): boolean {
  return TIME_HINT.test(text || "");
}

export function meetingPrompt(from: string, subject: string, body: string, todayISO: string): string {
  return `Today is ${todayISO}.\nFrom: ${from}\nSubject: ${subject}\n\n${body.slice(0, 2000)}`;
}

export function parseMeetingTimes(raw: string, todayISO: string): ProposedTime[] {
  const a = raw.indexOf("[");
  const b = raw.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  let arr: unknown;
  try { arr = JSON.parse(raw.slice(a, b + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: ProposedTime[] = [];
  for (const row of arr) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "");
    const start = String(r.start ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start)) continue;
    // A proposal for a day that has already gone is not a proposal.
    if (date < todayISO) continue;
    const dur = typeof r.durationMin === "number" && r.durationMin > 0 && r.durationMin <= 480 ? r.durationMin : 60;
    const label = String(r.label ?? "").trim().slice(0, 60) || date + " " + start;
    out.push({ label, date, start, end: fmt(Math.min(24 * 60 - 1, toMin(start) + dur)) });
    if (out.length >= 5) break;
  }
  return out;
}

// Which of the sender's options are actually free. Events are the truth; a
// collision names the thing in the way so he can decide, rather than the
// option silently disappearing.
export function optionsAgainst(times: ProposedTime[], events: EventItem[]): TimeOption[] {
  return times.map((t) => {
    const s = toMin(t.start);
    const e = toMin(t.end);
    const hit = events.find((ev) => {
      if (ev.data.date !== t.date) return false;
      const es = toMin(ev.data.start);
      const ee = ev.data.end ? toMin(ev.data.end) : es + 60;
      return s < ee && es < e;
    });
    return hit ? { ...t, free: false, clash: hit.data.title } : { ...t, free: true };
  });
}

export function firstFree(options: TimeOption[]): TimeOption | null {
  return options.find((o) => o.free) ?? null;
}

// What the card says. Honest in all three shapes: one that fits, several that
// fit, or none, which is a real answer and not a failure to hide.
export function meetingLine(options: TimeOption[]): string {
  if (options.length === 0) return "";
  const free = options.filter((o) => o.free);
  const offered = options.length === 1 ? "one time" : options.length + " times";
  if (free.length === 0) return `Offered ${offered} · You're busy for all of them`;
  if (free.length === options.length) return `Offered ${offered} · All open`;
  return `Offered ${offered} · Only ${free.map((f) => f.label).join(", ")} is open`;
}

export function acceptBody(option: TimeOption): string {
  return `${option.label} works for me. I've put it in.`;
}
