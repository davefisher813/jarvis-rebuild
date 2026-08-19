import { describe, it, expect } from "vitest";
import { remindersToIcs, rruleFor, escapeText, fold } from "./ics";

// The calendar handoff. iOS cannot be made to fire a web app's alarm, so
// these events ARE the alarm: if this file is malformed, the meds reminder
// silently never goes off, which is the worst possible failure for the
// feature. Hence the pedantry.

const TODAY = "2026-08-19";

describe("rruleFor", () => {
  it("no days means every day", () => {
    expect(rruleFor({ time: "08:00" })).toBe("RRULE:FREQ=DAILY");
    expect(rruleFor({ time: "08:00", days: [] })).toBe("RRULE:FREQ=DAILY");
  });
  it("weekdays and weekends map to BYDAY", () => {
    expect(rruleFor({ time: "08:00", days: [1, 2, 3, 4, 5] })).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(rruleFor({ time: "08:00", days: [0, 6] })).toBe("RRULE:FREQ=WEEKLY;BYDAY=SU,SA");
  });
  it("sorts and dedupes an arbitrary set", () => {
    expect(rruleFor({ time: "08:00", days: [3, 1, 3] })).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,WE");
  });
});

describe("text escaping keeps a med name from breaking the file", () => {
  it("escapes the structural characters", () => {
    expect(escapeText("Vitamin D, 2x")).toBe("Vitamin D\\, 2x");
    expect(escapeText("a;b")).toBe("a\;b");
    expect(escapeText("a\\b")).toBe("a\\\\b");
    expect(escapeText("one\ntwo")).toBe("one\\ntwo");
  });
  it("folds long lines with a leading space on continuations", () => {
    const long = "SUMMARY:" + "x".repeat(120);
    const out = fold(long);
    expect(out).toContain("\r\n ");
    out.split("\r\n").forEach((l) => expect(l.length).toBeLessThanOrEqual(75));
  });
});

describe("remindersToIcs", () => {
  const one = [{ id: "r1", text: "Morning Meds", reminder: { time: "08:00" } }];

  it("emits a complete calendar with an alarm at the time", () => {
    const ics = remindersToIcs(one, TODAY);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("ACTION:DISPLAY");
    // At the time, not before: a reminder has no prepare phase.
    expect(ics).toContain("TRIGGER:PT0S");
    expect(ics).toContain("SUMMARY:Morning Meds");
    expect(ics).toContain("RRULE:FREQ=DAILY");
  });

  it("uses FLOATING local time, so 8am stays 8am in a new timezone", () => {
    const ics = remindersToIcs(one, TODAY);
    expect(ics).toContain("DTSTART:20260819T080000");
    // No trailing Z (UTC) and no TZID: that is what makes it floating.
    expect(ics).not.toMatch(/DTSTART:[0-9T]+Z/);
    expect(ics).not.toContain("TZID");
  });

  it("gives each reminder a stable UID so re-adding updates instead of duplicating", () => {
    const a = remindersToIcs(one, TODAY);
    const b = remindersToIcs(one, "2026-09-01");
    const uid = /UID:(.+)/.exec(a)![1];
    expect(uid).toBe(/UID:(.+)/.exec(b)![1]);
    expect(uid).toContain("r1");
  });

  it("puts every reminder in ONE file, so adding them all is one tap", () => {
    const ics = remindersToIcs([
      { id: "r1", text: "Morning Meds", reminder: { time: "08:00" } },
      { id: "r2", text: "Vitamin D", reminder: { time: "13:00", days: [1, 2, 3, 4, 5] } },
      { id: "r3", text: "Night Meds", reminder: { time: "21:00" } },
    ], TODAY);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  it("ends the event five minutes after it starts, and rolls the hour properly", () => {
    const ics = remindersToIcs([{ id: "r", text: "T", reminder: { time: "08:58" } }], TODAY);
    expect(ics).toContain("DTSTART:20260819T085800");
    expect(ics).toContain("DTEND:20260819T090300");
  });

  it("uses CRLF line endings, which stricter parsers require", () => {
    expect(remindersToIcs(one, TODAY)).toContain("\r\n");
  });
});
