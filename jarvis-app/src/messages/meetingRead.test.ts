import { describe, it, expect } from "vitest";
import { readWhen } from "./meetingRead";

// 2026-09-21 is a Monday. Every relative day below is counted from it, the day
// the message was WRITTEN, whatever day the test (or the reader) runs on.
const MON = "2026-09-21";

describe("readWhen: the sentence, not the model, says when", () => {
  it("See you Tuesday at 3 PM: a whole answer, nothing missing", () => {
    const w = readWhen("See you Tuesday at 3 PM", MON);
    expect(w).toMatchObject({ date: "2026-09-22", start: "15:00", missing: [], conflicting: false });
    expect(w.timeZone).toBeUndefined();
  });

  it("Tuesday at 3: the day is known, AM or PM is asked, and no time is invented", () => {
    const w = readWhen("Tuesday at 3", MON);
    expect(w.date).toBe("2026-09-22");
    expect(w.start).toBeUndefined();
    expect(w.missing).toEqual(["meridiem"]);
  });

  it("Thursday morning: a day and a day part, never 9 AM", () => {
    const w = readWhen("Thursday morning works", MON);
    expect(w.date).toBe("2026-09-24");
    expect(w.dayPart).toBe("morning");
    expect(w.start).toBeUndefined();
    expect(w.missing).toEqual(["time"]);
  });

  it("tomorrow at 10 resolves against the SOURCE day and asks for the meridiem", () => {
    const w = readWhen("Tomorrow at 10?", MON);
    expect(w.date).toBe("2026-09-22");
    expect(w.missing).toEqual(["meridiem"]);
    // The same words in a message sent a week later mean a different day.
    expect(readWhen("Tomorrow at 10?", "2026-09-28").date).toBe("2026-09-29");
  });

  it("a day part settles an hour the sender left bare: 3 this afternoon is 3 PM", () => {
    expect(readWhen("Tuesday at 3 in the afternoon", MON)).toMatchObject({ start: "15:00", missing: [] });
    expect(readWhen("tonight at 8", MON)).toMatchObject({ date: MON, start: "20:00", missing: [] });
    expect(readWhen("Wednesday at 9 in the morning", MON)).toMatchObject({ start: "09:00", missing: [] });
  });

  it("a plain weekday is the NEXT one, and the sender's own weekday is a week out", () => {
    expect(readWhen("Monday at 3 PM", MON).date).toBe("2026-09-28");
    expect(readWhen("Friday at 3 PM", MON).date).toBe("2026-09-25");
  });

  it("this and next: next Tuesday said on a Monday is the following week", () => {
    expect(readWhen("this Friday at 3 PM", MON).date).toBe("2026-09-25");
    expect(readWhen("next Tuesday at 3 PM", MON).date).toBe("2026-09-29");
    expect(readWhen("next Monday at 3 PM", MON).date).toBe("2026-09-28");
    // From a Saturday, next Tuesday is the Tuesday after the coming one starts.
    expect(readWhen("next Tuesday at 3 PM", "2026-09-26").date).toBe("2026-09-29");
  });

  it("explicit dates: month names, numeric, ISO, and a weekday that agrees with them", () => {
    expect(readWhen("Wednesday, September 23rd at 1:00 PM ET", MON))
      .toMatchObject({ date: "2026-09-23", start: "13:00", timeZone: "America/New_York", missing: [] });
    expect(readWhen("9/23 at 4:15pm", MON)).toMatchObject({ date: "2026-09-23", start: "16:15" });
    expect(readWhen("2026-10-02 14:30", MON)).toMatchObject({ date: "2026-10-02", start: "14:30" });
    expect(readWhen("the 25th at 5 PM", MON)).toMatchObject({ date: "2026-09-25", start: "17:00" });
  });

  it("a month-day already past belongs to next year, counted from the message", () => {
    expect(readWhen("January 5 at 2 PM", "2026-12-20").date).toBe("2027-01-05");
    // February 31 is not a day.
    expect(readWhen("February 31 at 2 PM", MON).date).toBeUndefined();
  });

  it("a weekday that disagrees with the explicit date is a conflict, not a pick", () => {
    const w = readWhen("Thursday, September 23rd at 2 PM", MON);
    expect(w.conflicting).toBe(true);
    expect(w.date).toBeUndefined();
    expect(w.missing).toContain("date");
  });

  it("two days or two times in one sentence are asked about, never chosen", () => {
    const d = readWhen("Tuesday or Wednesday at 3 PM", MON);
    expect(d.conflicting).toBe(true);
    expect(d.date).toBeUndefined();
    const t = readWhen("Tuesday at 3 PM or 4 PM", MON);
    expect(t.conflicting).toBe(true);
    expect(t.start).toBeUndefined();
    expect(t.missing).toContain("time");
  });

  it("a range states its end, and one meridiem covers both sides", () => {
    expect(readWhen("Tuesday 3-4 PM", MON)).toMatchObject({ start: "15:00", end: "16:00", durationStated: true });
    expect(readWhen("Tuesday from 10:30 to 11:15 am", MON)).toMatchObject({ start: "10:30", end: "11:15", durationStated: true });
    // 11-1 pm is 11 AM to 1 PM, not eleven at night.
    expect(readWhen("Tuesday 11-1 pm", MON)).toMatchObject({ start: "11:00", end: "13:00" });
  });

  it("a range with no meridiem anywhere is asked about", () => {
    const w = readWhen("Tuesday 3:00-4:00", MON);
    expect(w.start).toBeUndefined();
    expect(w.missing).toEqual(["meridiem"]);
  });

  it("a stated length gives an end; an unstated one does not", () => {
    expect(readWhen("Tuesday at 3 PM for 45 minutes", MON)).toMatchObject({ start: "15:00", end: "15:45", durationStated: true });
    expect(readWhen("Tuesday at 3 PM for an hour", MON)).toMatchObject({ end: "16:00", durationStated: true });
    const w = readWhen("Tuesday at 3 PM", MON);
    expect(w.end).toBeUndefined();
    expect(w.durationStated).toBe(false);
  });

  it("a range that runs past midnight is not drawn: the end is dropped, the length is not claimed", () => {
    const w = readWhen("Friday 10 PM to 1 AM", MON);
    expect(w.start).toBe("22:00");
    expect(w.end).toBeUndefined();
    expect(w.overnight).toBe(true);
    expect(w.durationStated).toBe(false);
  });

  it("24-hour clocks read themselves; a bare 3:30 does not", () => {
    expect(readWhen("Tuesday 15:00", MON)).toMatchObject({ start: "15:00", missing: [] });
    expect(readWhen("Tuesday 08:30", MON)).toMatchObject({ start: "08:30", missing: [] });
    expect(readWhen("Tuesday 3:30", MON).missing).toEqual(["meridiem"]);
  });

  it("noon is a time", () => {
    expect(readWhen("Tuesday at noon", MON)).toMatchObject({ start: "12:00", missing: [] });
  });

  it("zones: a US abbreviation names one, an ambiguous one stays missing", () => {
    expect(readWhen("Tuesday at 3 PM PT", MON).timeZone).toBe("America/Los_Angeles");
    expect(readWhen("Tuesday at 3 PM EST", MON).timeZone).toBe("America/New_York");
    expect(readWhen("Tuesday at 3 PM Europe/London", MON).timeZone).toBe("Europe/London");
    const w = readWhen("Tuesday at 3 PM CST", MON);
    expect(w.timeZone).toBeUndefined();
    expect(w.missing).toContain("timezone");
  });

  it("PT the therapy is not Pacific Time", () => {
    const w = readWhen("PT appointment Tuesday at 3 PM", MON);
    expect(w.timeZone).toBeUndefined();
    expect(w.missing).toEqual([]);
  });

  it("numbers that are not clock times are left alone", () => {
    const w = readWhen("We have 3 players and 10 kids coming Tuesday", MON);
    expect(w.start).toBeUndefined();
    expect(w.date).toBe("2026-09-22");
    expect(readWhen("at 3 players", MON).signals).toBe(false);
    expect(readWhen("1/2 an hour", MON).signals).toBe(false);
  });

  it("a sentence with no day and no time carries no signal", () => {
    const w = readWhen("Sounds good, thanks", MON);
    expect(w.signals).toBe(false);
    expect(w.missing).toEqual(["date", "time"]);
  });

  it("dots in a.m. and p.m. are read", () => {
    expect(readWhen("Tuesday at 3 p.m.", MON)).toMatchObject({ start: "15:00" });
    expect(readWhen("Tuesday at 9:15 a.m.", MON)).toMatchObject({ start: "09:15" });
  });

  it("the month rolls: the 3rd said on the 29th is next month's", () => {
    expect(readWhen("the 3rd at 2 PM", "2026-09-29").date).toBe("2026-10-03");
  });

  it("the weekday does not depend on the machine's own zone or clock", () => {
    // Pure day arithmetic: 2026-03-08 is the US spring-forward day.
    expect(readWhen("tomorrow at 2 PM", "2026-03-07").date).toBe("2026-03-08");
    expect(readWhen("tomorrow at 2 PM", "2026-03-08").date).toBe("2026-03-09");
    expect(readWhen("tomorrow at 2 PM", "2026-11-01").date).toBe("2026-11-02");
    expect(readWhen("tomorrow at 2 PM", "2026-12-31").date).toBe("2027-01-01");
  });

  it("a message with no usable timestamp resolves nothing relative to it", () => {
    for (const q of ["See you Tuesday at 3 PM", "Tomorrow at 10", "the 25th at 5 PM", "September 23 at 1 PM"]) {
      const w = readWhen(q, null);
      expect(w.date, q).toBeUndefined();
      expect(w.missing, q).toContain("date");
      expect(w.signals, q).toBe(true);
    }
    // A date that states its own year needs no reference day.
    expect(readWhen("September 23, 2026 at 1 PM", null)).toMatchObject({ date: "2026-09-23", start: "13:00" });
    expect(readWhen("2026-10-02 14:30", null).date).toBe("2026-10-02");
    // The time itself never depended on the day.
    expect(readWhen("See you Tuesday at 3 PM", null).start).toBe("15:00");
  });
});
