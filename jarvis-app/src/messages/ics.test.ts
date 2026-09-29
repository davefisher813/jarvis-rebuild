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

  it("a TZID in the reader's own zone is that wall clock, untouched", () => {
    const e = readIcs(wrap("SUMMARY:Visit\r\nDTSTART;TZID=America/New_York:20260923T130000"), { zone: "America/New_York" }).event!;
    expect(e.start).toBe("13:00");
    expect(e.date).toBe("2026-09-23");
    expect(e.sourceZone).toBeUndefined();
  });

  it("a TZID that just spells out UTC converts, it doesn't read as literal local time", () => {
    // Dave 2026-09-04: a phone-call invite (DTSTART;TZID=UTC:...20260904T140000)
    // landed on the schedule 4 hours off -- exactly the EDT/UTC gap -- because
    // this used to fall into the "unknown TZID, trust the digits" branch. UTC
    // needs no timezone database to resolve; it's the one TZID with zero
    // ambiguity, so it gets the same conversion a bare Z suffix gets.
    const e = readIcs(wrap("SUMMARY:Call\r\nDTSTART;TZID=UTC:20260923T170000")).event!;
    const local = new Date(Date.UTC(2026, 8, 23, 17, 0));
    const hh = String(local.getHours()).padStart(2, "0");
    const mm = String(local.getMinutes()).padStart(2, "0");
    expect(e.start).toBe(`${hh}:${mm}`);
  });

  it("also folds Etc/UTC and GMT into the same UTC conversion", () => {
    const a = readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=Etc/UTC:20260923T170000")).event!;
    const b = readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=GMT:20260923T170000")).event!;
    const z = readIcs(wrap("SUMMARY:X\r\nDTSTART:20260923T170000Z")).event!;
    expect(a.start).toBe(z.start);
    expect(b.start).toBe(z.start);
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

// 2026-09-29: identity, status and zone. The old reader called any TZID but
// UTC the reader's local time, which is only right when the invitation is in
// the reader's own zone.
const NY = { zone: "America/New_York" };
const LON = { zone: "Europe/London" };

describe("a named zone is converted, not read as local", () => {
  it("Los Angeles 10:00 is 1 PM in New York, and the file's own clock is kept beside it", () => {
    const e = readIcs(wrap("SUMMARY:Call\r\nDTSTART;TZID=America/Los_Angeles:20260923T100000"), NY).event!;
    expect(e.date).toBe("2026-09-23");
    expect(e.start).toBe("13:00");
    expect(e.sourceZone).toBe("America/Los_Angeles");
    expect(e.sourceDate).toBe("2026-09-23");
    expect(e.sourceStart).toBe("10:00");
  });

  it("the date moves too: Tokyo 8 AM is the evening before in New York", () => {
    const e = readIcs(wrap("SUMMARY:Call\r\nDTSTART;TZID=Asia/Tokyo:20260923T080000"), NY).event!;
    expect(e.date).toBe("2026-09-22");
    expect(e.start).toBe("19:00");
  });

  it("follows daylight saving in the file's zone: London 13:00 is 8 AM in New York in September and 9 AM in the last week of October", () => {
    // London is on BST (UTC+1) until Oct 25 2026, New York on EDT until Nov 1.
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=Europe/London:20260930T130000"), NY).event!.start).toBe("08:00");
    // Between the two changes London is on GMT and New York is still on EDT.
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=Europe/London:20261027T130000"), NY).event!.start).toBe("09:00");
    // After both have changed.
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=Europe/London:20261201T130000"), NY).event!.start).toBe("08:00");
  });

  it("follows daylight saving in the reader's zone: the same UTC file lands an hour apart across the change", () => {
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART:20261031T170000Z"), NY).event!.start).toBe("13:00");
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART:20261101T170000Z"), NY).event!.start).toBe("12:00");
  });

  it("a duration is real elapsed time: 1:30 to 3:30 across the spring-forward night is one hour", () => {
    const e = readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=America/New_York:20260308T013000\r\nDTEND;TZID=America/New_York:20260308T033000"), NY).event!;
    expect(e.start).toBe("01:30");
    expect(e.durationMin).toBe(60);
  });

  it("a wall clock that does not exist in its zone is flagged, not quietly moved", () => {
    // 2:30 AM on 2026-03-08 does not exist in New York: the clock jumps from 2:00 to 3:00.
    const e = readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=America/New_York:20260308T023000"), LON).event!;
    expect(e.timeUncertain).toBe(true);
  });

  it("a wall clock that happens twice is flagged too", () => {
    // 1:30 AM on 2026-11-01 happens twice in New York.
    const e = readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=America/New_York:20261101T013000"), LON).event!;
    expect(e.timeUncertain).toBe(true);
    // An ordinary time that day is not.
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=America/New_York:20261101T093000"), LON).event!.timeUncertain).toBeUndefined();
  });

  it("Windows zone names from Outlook are read for the common US zones", () => {
    const e = readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=Eastern Standard Time:20260923T130000"), { zone: "America/Los_Angeles" }).event!;
    expect(e.start).toBe("10:00");
    expect(e.sourceZone).toBe("America/New_York");
  });

  it("a zone it cannot resolve is read as the reader's own clock AND flagged", () => {
    const e = readIcs(wrap("SUMMARY:X\r\nDTSTART;TZID=Customized Time Zone:20260923T130000"), NY).event!;
    expect(e.start).toBe("13:00");
    expect(e.zoneUnresolved).toBe("Customized Time Zone");
    expect(e.sourceZone).toBeUndefined();
  });

  it("floating times are the reader's own, on any zone", () => {
    expect(readIcs(wrap("SUMMARY:X\r\nDTSTART:20260923T130000"), { zone: "Asia/Tokyo" }).event!.start).toBe("13:00");
  });

  it("an all-day event is still just a date, whatever zone is named", () => {
    const e = readIcs(wrap("SUMMARY:X\r\nDTSTART;VALUE=DATE;TZID=Asia/Tokyo:20260923"), NY).event!;
    expect(e).toEqual({ title: "X", date: "2026-09-23" });
  });
});

describe("identity and status", () => {
  const invite = (extra: string, cal = "") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${cal}BEGIN:VEVENT\r\nSUMMARY:Review\r\nDTSTART:20260923T130000\r\n${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

  it("reads UID and SEQUENCE, so a changed invitation is the same event", () => {
    const a = readIcs(invite("UID:abc-123@calendar.example\r\nSEQUENCE:0"), NY).event!;
    const b = readIcs(invite("UID:abc-123@calendar.example\r\nSEQUENCE:2"), NY).event!;
    expect(a.uid).toBe("abc-123@calendar.example");
    expect(b.uid).toBe(a.uid);
    expect([a.sequence, b.sequence]).toEqual([0, 2]);
  });

  it("METHOD:CANCEL and STATUS:CANCELLED both read as cancelled", () => {
    expect(readIcs(invite("UID:x", "METHOD:CANCEL\r\n"), NY).event!).toMatchObject({ method: "CANCEL", status: "cancelled" });
    expect(readIcs(invite("UID:x\r\nSTATUS:CANCELLED"), NY).event!.status).toBe("cancelled");
    expect(readIcs(invite("UID:x\r\nSTATUS:CANCELED"), NY).event!.status).toBe("cancelled");
    expect(readIcs(invite("UID:x\r\nSTATUS:TENTATIVE"), NY).event!.status).toBe("tentative");
    expect(readIcs(invite("UID:x", "METHOD:REQUEST\r\n"), NY).event!.status).toBeUndefined();
  });

  it("reads the organizer and attendees, with quoted names and mailto values", () => {
    const e = readIcs(invite([
      'ORGANIZER;CN="Patel, MD":mailto:Office@Clinic.example',
      "ATTENDEE;CN=Dave Fisher;PARTSTAT=ACCEPTED:mailto:dave@me.com",
      "ATTENDEE:mailto:nurse@clinic.example",
    ].join("\r\n")), NY).event!;
    expect(e.organizer).toEqual({ email: "office@clinic.example", name: "Patel, MD" });
    expect(e.attendees).toEqual([{ email: "dave@me.com", name: "Dave Fisher" }, { email: "nurse@clinic.example" }]);
  });

  it("an event with none of it carries none of it", () => {
    const e = readIcs(wrap("SUMMARY:Plain\r\nDTSTART:20260923T130000"), NY).event!;
    expect(e).toEqual({ title: "Plain", date: "2026-09-23", start: "13:00" });
  });

  it("still reads only the first event, and says how many there were", () => {
    const raw = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\n"
      + "BEGIN:VEVENT\r\nUID:one\r\nSUMMARY:First\r\nDTSTART:20260923T130000\r\nEND:VEVENT\r\n"
      + "BEGIN:VEVENT\r\nUID:two\r\nSUMMARY:Second\r\nDTSTART:20260924T090000\r\nSTATUS:CANCELLED\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const r = readIcs(raw, NY);
    expect(r.count).toBe(2);
    expect(r.event).toMatchObject({ uid: "one", title: "First", method: "REQUEST" });
    expect(r.event!.status).toBeUndefined();
  });
});
