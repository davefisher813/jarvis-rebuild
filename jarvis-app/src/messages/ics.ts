import { deviceZone, instantAt, isValidZone, wallInZone, wallStatus } from "./zoneTime";

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
// 2026-09-29: THE FILE'S IDENTITY, STATUS AND ZONE ARE READ NOW. An invitation
// says WHICH event it is (UID, and SEQUENCE for which revision), what it is for
// the reader (METHOD: a request, or a cancellation), whether the organizer has
// called it off (STATUS), who is on it (ORGANIZER, ATTENDEE) and, above all,
// WHERE its clock is (TZID). The last one was read as the reader's own local
// time for any zone but UTC, which is right for an invitation in your own zone
// and hours wrong for anyone else's. A named zone is now converted through the
// platform's zone database, so a daylight-saving change inside it is honoured
// (zoneTime.ts), and a zone the file names that cannot be resolved is FLAGGED
// (zoneUnresolved) instead of silently read as local. A wall time that does
// not exist or happens twice in its zone (the spring-forward gap, the
// fall-back hour) is flagged timeUncertain, and nothing built on it picks one.
// None of this WRITES anything: a cancellation or an update is reported, and
// the calendar is only ever changed by a tap (see emailSchedule.ts).
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

export interface IcsPerson { email?: string; name?: string }

export interface IcsEvent {
  title: string;
  date: string;           // YYYY-MM-DD, the READER'S wall date (converted when the file names a zone)
  start?: string;         // HH:MM, the reader's wall clock, absent for an all-day event
  durationMin?: number;
  /** The event's own identity. The same UID with a higher SEQUENCE is the same event, changed. */
  uid?: string;
  sequence?: number;
  /** The calendar's METHOD: REQUEST, CANCEL, PUBLISH and so on, upper-case. */
  method?: string;
  /** From STATUS. A METHOD:CANCEL file reads as cancelled too. */
  status?: "confirmed" | "tentative" | "cancelled";
  organizer?: IcsPerson;
  attendees?: IcsPerson[];
  /** The IANA zone the file wrote its clock in, when it named one that resolved and is not the reader's. */
  sourceZone?: string;
  /** The date and clock as the FILE wrote them, in sourceZone. */
  sourceDate?: string;
  sourceStart?: string;
  /** A TZID the file named that could not be resolved. The clock was read as the reader's own and is not to be trusted. */
  zoneUnresolved?: string;
  /** The wall clock does not exist, or happens twice, in its own zone that day. */
  timeUncertain?: boolean;
}

export interface IcsOptions {
  /** The zone the reader's clock is in. Defaults to the device's. */
  zone?: string;
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
function parseLine(line: string): { name: string; params: string; rawParams: string; value: string } | null {
  // The first colon outside a quoted parameter value ends the name and params:
  // CN="Smith: Dr" would otherwise be cut in half.
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) { colon = i; break; }
  }
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const semi = left.indexOf(";");
  const rawParams = semi < 0 ? "" : left.slice(semi + 1);
  return {
    name: (semi < 0 ? left : left.slice(0, semi)).trim().toUpperCase(),
    params: rawParams.toUpperCase(),
    rawParams,
    value: line.slice(colon + 1).trim(),
  };
}

// Text values escape commas, semicolons and newlines. Unescaping is the whole
// difference between "Smith\, Dr." and "Smith\, Dr." on the schedule.
const unescapeText = (v: string): string =>
  v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();

interface Stamp {
  date: string;
  start?: string;
  ms?: number;
  sourceZone?: string;
  sourceDate?: string;
  sourceStart?: string;
  unresolved?: string;
  uncertain?: boolean;
}

// A TZID naming UTC itself needs no timezone database to resolve -- there is
// no ambiguity to look up, only an offset of zero. Several real senders
// (Dave 2026-09-04: a phone-call invite from a tax-prep tool landed 4 hours
// off, exactly the EDT/UTC gap) write DTSTART;TZID=UTC:... instead of the Z
// suffix RFC 5545 prefers. Reading that as floating local time was the bug:
// it took a UTC instant and displayed its digits as if they were already the
// reader's own wall clock.
const UTC_TZIDS = new Set(["UTC", "ETC/UTC", "GMT", "Z", "UT", "ETC/GMT"]);

// Outlook and Exchange write Windows zone names, not IANA ones. The handful
// that cover US mail; anything else is flagged unresolved rather than guessed.
const WINDOWS_ZONES: Record<string, string> = {
  "eastern standard time": "America/New_York",
  "central standard time": "America/Chicago",
  "mountain standard time": "America/Denver",
  "pacific standard time": "America/Los_Angeles",
  "alaskan standard time": "America/Anchorage",
  "hawaiian standard time": "Pacific/Honolulu",
  "gmt standard time": "Europe/London",
  "greenwich standard time": "UTC",
  "utc": "UTC",
};

function readTzid(rawParams: string): string | null {
  const m = /TZID=("?)([^;"]+)\1/i.exec(rawParams);
  return m ? m[2]!.trim() : null;
}

/**
 * One DTSTART / DTEND value, as the READER's wall clock.
 *
 * Forms that exist in the wild, all handled here:
 *   20260923            an all-day date (VALUE=DATE). No time, and none invented.
 *   20260923T130000Z    UTC. Converted to the reader's own zone.
 *   ;TZID=UTC:...       the same, spelled differently.
 *   ;TZID=America/New_York:20260923T130000
 *                       a named zone, converted through the platform's zone
 *                       database, so daylight saving inside it is honoured.
 *   ;TZID=Eastern Standard Time:...
 *                       a Windows name, mapped for the common US ones.
 *   20260923T130000     floating: the reader's own clock, by definition.
 *
 * A TZID that cannot be resolved is read as the reader's own clock AND
 * flagged (unresolved), because the alternative, converting with a guess, is
 * how an invitation lands hours off with nothing on screen to say so.
 */
function readStamp(params: string, rawParams: string, value: string, dev: string): Stamp | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly || params.includes("VALUE=DATE")) {
    const m = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
    if (!m) return null;
    return { date: `${m[1]}-${m[2]}-${m[3]}` };
  }
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!full) return null;
  const [, y, mo, d, h, mi, , z] = full;
  const date = `${y}-${mo}-${d}`;
  const time = `${h}:${mi}`;
  const tzid = readTzid(rawParams);

  if (z || (tzid && UTC_TZIDS.has(tzid.toUpperCase()))) {
    const at = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!);
    const local = wallInZone(at, dev);
    return { date: local.date, start: local.time, ms: at };
  }

  if (tzid) {
    const win = WINDOWS_ZONES[tzid.toLowerCase()];
    const zone = /^[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+)+$/.test(tzid) && isValidZone(tzid) ? tzid : win;
    if (zone && isValidZone(zone)) {
      const status = wallStatus(date, time, zone);
      const at = instantAt(date, time, zone);
      if (zone === dev) return { date, start: time, ms: at, ...(status !== "ok" ? { uncertain: true } : {}) };
      const local = wallInZone(at, dev);
      return {
        date: local.date, start: local.time, ms: at,
        sourceZone: zone, sourceDate: date, sourceStart: time,
        ...(status !== "ok" ? { uncertain: true } : {}),
      };
    }
    // Named, and not one this can resolve. The clock is read as the reader's
    // own, and the file's claim is carried so the card can say it is unsure.
    return { date, start: time, ms: instantAt(date, time, dev), unresolved: tzid };
  }

  return { date, start: time, ms: instantAt(date, time, dev) };
}

// ISO 8601 duration, the subset calendars actually emit: PT30M, PT1H, PT1H30M,
// P1D. Anything else returns null rather than a guess.
function readDuration(v: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(v.trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

// ORGANIZER;CN=Dr. Patel:mailto:office@clinic.example
function readPerson(rawParams: string, value: string): IcsPerson | null {
  const mail = /^mailto:(.+)$/i.exec(value.trim());
  const cn = /CN=("([^"]*)"|[^;]*)/i.exec(rawParams);
  const name = cn ? unescapeText((cn[2] ?? cn[1] ?? "").replace(/^"|"$/g, "")) : "";
  const email = mail ? mail[1]!.trim().toLowerCase() : "";
  if (!email && !name) return null;
  return { ...(email ? { email } : {}), ...(name ? { name } : {}) };
}

export interface IcsRead {
  event: IcsEvent | null;
  /** How many VEVENTs the file held. The card says so when it is more than one. */
  count: number;
}

const STATUS_WORDS: Record<string, IcsEvent["status"]> = { CONFIRMED: "confirmed", TENTATIVE: "tentative", CANCELLED: "cancelled", CANCELED: "cancelled" };

export function readIcs(raw: string, opts: IcsOptions = {}): IcsRead {
  if (!raw || !/BEGIN:VEVENT/i.test(raw)) return { event: null, count: 0 };
  const dev = isValidZone(opts.zone) ? opts.zone : deviceZone();
  const lines = unfold(raw);

  let depth = 0;
  let count = 0;
  let title = "";
  let dtstart: Stamp | null = null;
  let dtend: Stamp | null = null;
  let durMin: number | null = null;
  let captured = false;
  let uid = "";
  let sequence: number | undefined;
  let method = "";
  let status: IcsEvent["status"];
  let organizer: IcsPerson | undefined;
  const attendees: IcsPerson[] = [];

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
    // The calendar-level METHOD sits outside any event.
    if (depth === 0 && p.name === "METHOD") { method = p.value.toUpperCase(); continue; }
    if (depth !== 1 || captured) continue;
    if (p.name === "SUMMARY") title = unescapeText(p.value);
    else if (p.name === "DTSTART") dtstart = readStamp(p.params, p.rawParams, p.value, dev);
    else if (p.name === "DTEND") dtend = readStamp(p.params, p.rawParams, p.value, dev);
    else if (p.name === "DURATION") durMin = readDuration(p.value);
    else if (p.name === "UID") uid = p.value.trim();
    else if (p.name === "SEQUENCE") { const n = Number(p.value); if (Number.isInteger(n) && n >= 0) sequence = n; }
    else if (p.name === "STATUS") status = STATUS_WORDS[p.value.toUpperCase()] ?? status;
    else if (p.name === "ORGANIZER") organizer = readPerson(p.rawParams, p.value) ?? organizer;
    else if (p.name === "ATTENDEE") { const a = readPerson(p.rawParams, p.value); if (a && attendees.length < 50) attendees.push(a); }
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
  if (uid) ev.uid = uid;
  if (sequence !== undefined) ev.sequence = sequence;
  if (method) ev.method = method;
  // A cancelling METHOD says cancelled whatever STATUS says: the organizer sent
  // the file to call the event off.
  if (method === "CANCEL") ev.status = "cancelled";
  else if (status) ev.status = status;
  if (organizer) ev.organizer = organizer;
  if (attendees.length) ev.attendees = attendees;
  if (dtstart.sourceZone) { ev.sourceZone = dtstart.sourceZone; ev.sourceDate = dtstart.sourceDate!; ev.sourceStart = dtstart.sourceStart!; }
  if (dtstart.unresolved) ev.zoneUnresolved = dtstart.unresolved;
  if (dtstart.uncertain) ev.timeUncertain = true;
  return { event: ev, count };
}
