// THE .ICS ACTUALLY GETS READ (Dave 2026-08-25, from the email audit).
//
// The attachment card said "Add It to Your Calendar" with an Add button, and
// the handler fired a toast reading "Open the attachment to add it · Your
// Calendar handles .ics", marked the card done, and hid it. It handed the job
// back and then removed the offer. Meanwhile the home page had just learned to
// put an appointment on the schedule in one tap, so the same email got two
// different answers depending on which screen you were looking at.
//
// A calendar file is not a mystery format. It states the title, the start and
// the end. Reading it is the difference between a button that works and a
// button that apologises.
//
// Laws, the same three the mail actions run under:
//   1. NEVER INVENT. A file we cannot parse produces nothing, and the card
//      falls back to opening the attachment. There is no default hour, no
//      default day, and no "probably an hour long".
//   2. DEGRADE, NEVER UPGRADE. An all-day event has a date and no time. It
//      stays a date, and the caller turns it into a task rather than picking
//      a time nobody wrote down.
//   3. FIRST VEVENT ONLY. An invitation with six events in it is not a thing
//      this button can honestly represent, so it takes the first and the
//      caller says how many were skipped.

export interface IcsEvent {
  title: string;
  date: string;           // YYYY-MM-DD, local wall date
  start?: string;         // HH:MM, absent for an all-day event
  durationMin?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

// RFC 5545 folds long lines by inserting CRLF followed by a single space or
// tab. Unfolding first means a SUMMARY longer than 75 octets is not read as
// two properties, which is most real invitations.
function unfold(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

// SUMMARY:Dental cleaning        -> { name: "SUMMARY", params: "",             value: "Dental cleaning" }
// DTSTART;TZID=America/New_York:20260923T130000
function parseLine(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const semi = left.indexOf(";");
  return {
    name: (semi < 0 ? left : left.slice(0, semi)).trim().toUpperCase(),
    params: semi < 0 ? "" : left.slice(semi + 1).toUpperCase(),
    value: line.slice(colon + 1).trim(),
  };
}

// Text values escape commas, semicolons and newlines. Unescaping is the whole
// difference between "Smith\, Dr." and "Smith\, Dr." on the schedule.
const unescapeText = (v: string): string =>
  v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();

interface Stamp { date: string; start?: string; ms?: number }

/**
 * One DTSTART / DTEND value.
 *
 * Three forms exist in the wild and all three appear here:
 *   20260923            an all-day date (VALUE=DATE). No time, and none invented.
 *   20260923T130000Z    UTC. Converted to the reader's own wall clock.
 *   20260923T130000     floating, or carrying a TZID.
 *
 * The TZID case is read as LOCAL wall time rather than converted, because
 * converting needs a timezone database this app does not ship. That is the
 * right trade for the common case (the invitation is in your own zone) and it
 * is wrong for a genuinely foreign meeting, which is exactly why the card
 * shows the time it is about to write before you tap it.
 */
function readStamp(params: string, value: string): Stamp | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || params.includes("VALUE=DATE")) {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    return { date: `${m[1]}-${m[2]}-${m[3]}` };
  }
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!full) return null;
  const [, y, mo, d, h, mi, , z] = full;
  if (z) {
    const at = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!);
    const local = new Date(at);
    return {
      date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
      start: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
      ms: at,
    };
  }
  return {
    date: `${y}-${mo}-${d}`,
    start: `${h}:${mi}`,
    ms: new Date(+y!, +mo! - 1, +d!, +h!, +mi!).getTime(),
  };
}

// ISO 8601 duration, the subset calendars actually emit: PT30M, PT1H, PT1H30M,
// P1D. Anything else returns null rather than a guess.
function readDuration(v: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(v.trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

export interface IcsRead {
  event: IcsEvent | null;
  /** How many VEVENTs the file held. The card says so when it is more than one. */
  count: number;
}

export function readIcs(raw: string): IcsRead {
  if (!raw || !/BEGIN:VEVENT/i.test(raw)) return { event: null, count: 0 };
  const lines = unfold(raw);

  let depth = 0;
  let count = 0;
  let title = "";
  let dtstart: Stamp | null = null;
  let dtend: Stamp | null = null;
  let durMin: number | null = null;
  let captured = false;

  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN" && p.value.toUpperCase() === "VEVENT") { depth++; count++; continue; }
    if (p.name === "END" && p.value.toUpperCase() === "VEVENT") {
      depth--;
      // Law 3: the first one is the one this button represents. Later events
      // are counted and not read, so a six-event file cannot silently become
      // whichever event happened to sort last.
      if (dtstart) captured = true;
      continue;
    }
    if (depth !== 1 || captured) continue;
    if (p.name === "SUMMARY") title = unescapeText(p.value);
    else if (p.name === "DTSTART") dtstart = readStamp(p.params, p.value);
    else if (p.name === "DTEND") dtend = readStamp(p.params, p.value);
    else if (p.name === "DURATION") durMin = readDuration(p.value);
  }

  // Law 1. No start, no event: an appointment with no date is not something
  // to put on a schedule, and the title alone is not an appointment.
  if (!dtstart) return { event: null, count };

  const ev: IcsEvent = {
    // A calendar file with no SUMMARY is rare and legal. "Appointment" is a
    // description of the file, not an invented fact about its contents.
    title: title || "Appointment",
    date: dtstart.date,
  };
  if (dtstart.start) {
    ev.start = dtstart.start;
    const spanMs = dtend?.ms != null && dtstart.ms != null ? dtend.ms - dtstart.ms : null;
    const mins = spanMs != null && spanMs > 0 ? Math.round(spanMs / 60000) : durMin;
    // Clamped to a real block. An invitation claiming a 40-hour meeting is a
    // parse gone wrong, not a meeting.
    if (mins != null && mins > 0) ev.durationMin = Math.min(1440, mins);
  }
  return { event: ev, count };
}
