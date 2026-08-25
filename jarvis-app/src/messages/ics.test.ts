import { describe, it, expect } from "vitest";
import { readIcs } from "./ics";

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n${body}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe("law 1: never invent", () => {
  it("reads nothing out of a file that is not a calendar", () => {
    expect(readIcs("hello")).toEqual({ event: null, count: 0 });
    expect(readIcs("")).toEqual({ event: null, count: 0 });
  });

  it("refuses an event with no start, however much else it has", () => {
    // A title and an end time is not an appointment. Before this the card
    // would have offered to add it anyway and picked the hour itself.
    const r = readIcs(wrap("SUMMARY:Dental cleaning\r\nDTEND:20260923T140000Z"));
    expect(r.event).toBeNull();
    expect(r.count).toBe(1);
  });

  it("refuses a start it cannot parse rather than reaching for today", () => {
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART:next Tuesday")).event).toBeNull();
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART:2026-09-23")).event).toBeNull();
  });

  it("invents no duration when the file states none", () => {
    const e = readIcs(wrap("SUMMARY:Call\r\nDTSTART:20260923T130000")).event;
    expect(e?.start).toBe("13:00");
    expect(e?.durationMin).toBeUndefined();
  });

  it("calls it Appointment when there is no SUMMARY, and nothing more", () => {
    // A description of the file, not a guess about its contents.
    expect(readIcs(wrap("DTSTART:20260923T130000")).event?.title).toBe("Appointment");
  });
});

describe("law 2: degrade, never upgrade", () => {
  it("an all-day event keeps its date and gets no time", () => {
    const e = readIcs(wrap("SUMMARY:Anniversary\r\nDTSTART;VALUE=DATE:20260923")).event;
    expect(e).toEqual({ title: "Anniversary", date: "2026-09-23" });
    expect(e?.start).toBeUndefined();
  });

  it("a bare eight-digit date is all-day even without VALUE=DATE", () => {
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART:20260923")).event?.start).toBeUndefined();
  });
});

describe("law 3: the first VEVENT is the one the button means", () => {
  it("takes the first and counts the rest", () => {
    const raw = "BEGIN:VCALENDAR\r\n"
      + "BEGIN:VEVENT\r\nSUMMARY:First\r\nDTSTART:20260923T130000\r\nEND:VEVENT\r\n"
      + "BEGIN:VEVENT\r\nSUMMARY:Second\r\nDTSTART:20260924T090000\r\nEND:VEVENT\r\n"
      + "BEGIN:VEVENT\r\nSUMMARY:Third\r\nDTSTART:20260925T090000\r\nEND:VEVENT\r\n"
      + "END:VCALENDAR";
    const r = readIcs(raw);
    expect(r.event?.title).toBe("First");
    expect(r.count).toBe(3);
  });
});

describe("the formats that actually turn up", () => {
  it("converts a UTC stamp to the reader's own wall clock", () => {
    // 17:00Z is 1 PM in New York, 6 PM in London. Whatever this machine is
    // set to, the event has to land at the local rendering of that instant.
    const e = readIcs(wrap("SUMMARY:Video visit\r\nDTSTART:20260923T170000Z\r\nDTEND:20260923T173000Z")).event!;
    const local = new Date(Date.UTC(2026, 8, 23, 17, 0));
    const hh = String(local.getHours()).padStart(2, "0");
    const mm = String(local.getMinutes()).padStart(2, "0");
    expect(e.start).toBe(`${hh}:${mm}`);
    expect(e.durationMin).toBe(30);
  });

  it("reads a TZID stamp as local wall time", () => {
    // Documented trade: converting needs a timezone database this app does
    // not ship. The card shows the time before you tap it for this reason.
    const e = readIcs(wrap("SUMMARY:Visit\r\nDTSTART;TZID=America/New_York:20260923T130000")).event!;
    expect(e.start).toBe("13:00");
    expect(e.date).toBe("2026-09-23");
  });

  it("takes a DURATION when there is no DTEND", () => {
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART:20260923T130000\r\nDURATION:PT45M")).event?.durationMin).toBe(45);
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART:20260923T130000\r\nDURATION:PT1H30M")).event?.durationMin).toBe(90);
  });

  it("unfolds a long SUMMARY instead of reading it as two properties", () => {
    // RFC 5545 folds at 75 octets with CRLF + one space. Most real
    // invitations from a practice management system are folded.
    const raw = wrap("SUMMARY:Video appointment with Resolve Psychiatric Serv\r\n ices Client Portal\r\nDTSTART:20260923T130000");
    expect(readIcs(raw).event?.title).toBe("Video appointment with Resolve Psychiatric Services Client Portal");
  });

  it("unescapes the text escapes the spec requires", () => {
    const e = readIcs(wrap("SUMMARY:Patel\\, MD\\; follow-up\r\nDTSTART:20260923T130000")).event!;
    expect(e.title).toBe("Patel, MD; follow-up");
  });

  it("survives LF-only files, which plenty of senders emit", () => {
    const raw = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:X\nDTSTART:20260923T130000\nEND:VEVENT\nEND:VCALENDAR";
    expect(readIcs(raw).event?.start).toBe("13:00");
  });

  it("clamps a duration that cannot be real", () => {
    // A forty-hour meeting is a parse gone wrong, not a meeting.
    const e = readIcs(wrap("SUMMARY:X\r\nDTSTART:20260923T130000\r\nDTEND:20260926T130000")).event!;
    expect(e.durationMin).toBe(1440);
  });

  it("ignores a DTEND that is before its DTSTART", () => {
    const e = readIcs(wrap("SUMMARY:X\r\nDTSTART:20260923T130000\r\nDTEND:20260923T120000")).event!;
    expect(e.durationMin).toBeUndefined();
  });
});
