import type { ReminderInfo } from "../notes/types";

// CALENDAR HANDOFF (Dave 2026-08-19: "whatever you can within the iOS").
//
// A web app cannot fire its own alarm. The API that would have allowed it
// (Notification Triggers) was abandoned and ships in no browser, and iOS web
// push needs a Home Screen install plus a server awake at 8am. So instead of
// pretending, JARVIS hands the job to the one scheduler already on the phone:
// iOS Calendar. We emit a standard iCalendar file with a repeat rule and an
// alarm, and iOS fires it every day, forever, offline, with JARVIS closed.
//
// Deliberate choices:
// - FLOATING LOCAL TIME. DTSTART carries no Z and no TZID, which in RFC 5545
//   means "whatever local time it is where the device is". 8am meds should
//   fire at 8am in a new timezone, not at 5am because the reminder was made
//   in New York. This is the one case where floating time is correct.
// - A STABLE UID per reminder, so re-adding an edited reminder updates the
//   existing entry rather than stacking a duplicate.
// - The alarm fires AT the time, not before: a reminder has no "prepare"
//   phase the way a meeting does.

const PAD = (n: number): string => String(n).padStart(2, "0");

// RFC 5545 wants CRLF and lines folded at 75 octets, continuation lines
// starting with a single space. Calendar apps are forgiving; iOS is less so
// with long lines, and a med name can be long.
export function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    out.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest) out.push(" " + rest);
  return out.join("\r\n");
}

// Backslash, semicolon and comma are structural in iCalendar text values;
// a newline becomes a literal \n. A med called "Vitamin D, 2x" must not
// silently split the property.
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function rruleFor(r: ReminderInfo): string {
  if (!r.days || r.days.length === 0) return "RRULE:FREQ=DAILY";
  const days = [...new Set(r.days)].sort().map((d) => BYDAY[d]).join(",");
  return "RRULE:FREQ=WEEKLY;BYDAY=" + days;
}

// The first occurrence: today at the reminder's time. A weekly rule whose
// BYDAY does not include today still starts correctly, because RRULE expands
// forward from DTSTART and iOS honours BYDAY over the seed day.
function dtStart(date: string, time: string): string {
  const [h, m] = time.split(":");
  return date.replace(/-/g, "") + "T" + PAD(Number(h ?? 0)) + PAD(Number(m ?? 0)) + "00";
}

function addMinutesToHHMM(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + mins;
  return PAD(Math.floor(total / 60) % 24) + ":" + PAD(total % 60);
}

export interface IcsReminder {
  id: string;
  text: string;
  reminder: ReminderInfo;
}

// One VEVENT per reminder, all in one file, so adding everything is one tap.
export function remindersToIcs(items: IcsReminder[], today: string, stamp = "20260101T000000Z"): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JARVIS//Reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const it of items) {
    const start = dtStart(today, it.reminder.time);
    const end = dtStart(today, addMinutesToHHMM(it.reminder.time, 5));
    lines.push(
      "BEGIN:VEVENT",
      "UID:jarvis-reminder-" + it.id + "@jarvis.app",
      "DTSTAMP:" + stamp,
      "DTSTART:" + start,
      "DTEND:" + end,
      fold("SUMMARY:" + escapeText(it.text)),
      rruleFor(it.reminder),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      fold("DESCRIPTION:" + escapeText(it.text)),
      // At the time itself, not before.
      "TRIGGER:PT0S",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// Hand the file to iOS. Safari honours the download attribute and offers to
// open it in Calendar, which is exactly the flow we want: the user sees what
// is being added and confirms it.
export function downloadIcs(ics: string, filename = "jarvis-reminders.ics"): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick: revoking synchronously can cancel the download
  // on Safari before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
