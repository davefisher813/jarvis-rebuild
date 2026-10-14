import { describe, it, expect } from "vitest";
import { parseScheduleExtract, toISODate, buildScheduleRows, normTitle, type ExtractedEvent, type ExistingEvent } from "./scheduleExtract";

const ex = (over: Partial<ExtractedEvent> = {}): ExtractedEvent =>
  ({ id: "x1", title: "vs Eagles", month: 8, day: 15, year: 2026, start: "14:00", end: null, location: "", recurring: false, weekdays: null, ...over });

const GOOD = JSON.stringify({
  events: [
    { title: "vs Eagles", month: 8, day: 15, year: 2026, start: "14:00", end: "15:30", location: "Home Field" },
    { title: "Practice", month: 8, day: 12, year: 2026, start: "17:00", end: null, location: "" },
  ],
});

describe("parseScheduleExtract", () => {
  it("parses a clean reply, keeping the source's words verbatim", () => {
    const rows = parseScheduleExtract(GOOD)!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "vs Eagles", month: 8, day: 15, year: 2026, start: "14:00", end: "15:30", location: "Home Field" });
    expect(rows[1]!.end).toBeNull();
  });

  it("strips code fences and surrounding prose", () => {
    expect(parseScheduleExtract("Here's what I found:\n```json\n" + GOOD + "\n```")).not.toBeNull();
    expect(parseScheduleExtract("Sure! " + GOOD)).not.toBeNull();
  });

  it("never guesses a missing year or time; leaves them null instead", () => {
    const raw = JSON.stringify({ events: [{ title: "Tournament", month: 3, day: 5, year: null, start: null, end: null, location: "" }] });
    const rows = parseScheduleExtract(raw)!;
    expect(rows[0]!.year).toBeNull();
    expect(rows[0]!.start).toBeNull();
  });

  it("drops rows with no title or no real month/day", () => {
    const raw = JSON.stringify({
      events: [
        { title: "", month: 8, day: 15, year: 2026, start: null, end: null, location: "" },
        { title: "Bad Date", month: 13, day: 40, year: 2026, start: null, end: null, location: "" },
        { title: "Good", month: 9, day: 1, year: null, start: null, end: null, location: "" },
      ],
    });
    const rows = parseScheduleExtract(raw)!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("Good");
  });

  it("rejects a malformed time rather than passing it through", () => {
    const raw = JSON.stringify({ events: [{ title: "Game", month: 8, day: 1, year: 2026, start: "2:00 PM", end: null, location: "" }] });
    expect(parseScheduleExtract(raw)![0]!.start).toBeNull();
  });

  it("clamps oversized titles and locations", () => {
    const raw = JSON.stringify({ events: [{ title: "x".repeat(200), month: 1, day: 1, year: 2026, start: null, end: null, location: "y".repeat(200) }] });
    const rows = parseScheduleExtract(raw)!;
    expect(rows[0]!.title.length).toBe(80);
    expect(rows[0]!.location.length).toBe(80);
  });

  it("returns null rather than inventing a schedule", () => {
    expect(parseScheduleExtract("I couldn't read that image, sorry.")).toBeNull();
    expect(parseScheduleExtract("{}")).toBeNull();
    expect(parseScheduleExtract(JSON.stringify({ events: [] }))).toBeNull();
    expect(parseScheduleExtract("{broken json")).toBeNull();
  });

  it("caps the number of events read from one upload", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ title: `E${i}`, month: 1, day: (i % 28) + 1, year: 2026, start: null, end: null, location: "" }));
    const rows = parseScheduleExtract(JSON.stringify({ events: many }))!;
    expect(rows.length).toBe(60);
  });
});

describe("toISODate", () => {
  it("builds a real calendar date", () => {
    expect(toISODate(2026, 8, 15)).toBe("2026-08-15");
    expect(toISODate(2026, 1, 5)).toBe("2026-01-05");
  });

  it("refuses a date that does not exist rather than rolling it forward", () => {
    expect(toISODate(2026, 2, 30)).toBeNull(); // Feb 30 does not exist
    expect(toISODate(2026, 4, 31)).toBeNull(); // April has 30 days
  });
});

describe("buildScheduleRows", () => {
  it("uses the row's own year when it has one, ignoring the fallback", () => {
    const rows = buildScheduleRows([ex({ year: 2027 })], 2026, []);
    expect(rows[0]!.date).toBe("2027-08-15");
  });

  it("applies the fallback year only when the source had none", () => {
    const rows = buildScheduleRows([ex({ year: null })], 2026, []);
    expect(rows[0]!.date).toBe("2026-08-15");
  });

  it("drops a row whose date is not real even after resolving the year", () => {
    const rows = buildScheduleRows([ex({ month: 2, day: 30, year: null })], 2026, []);
    expect(rows).toHaveLength(0);
  });

  it("defaults a missing start time and flags it, rather than inventing a plausible one", () => {
    const rows = buildScheduleRows([ex({ start: null })], 2026, []);
    expect(rows[0]!.start).toBe("09:00");
    expect(rows[0]!.noTime).toBe(true);
  });

  it("does not flag noTime when the source gave a real time", () => {
    const rows = buildScheduleRows([ex({ start: "14:00" })], 2026, []);
    expect(rows[0]!.noTime).toBe(false);
  });

  it("matches an existing event by exact title and date, and offers to update it", () => {
    const existing: ExistingEvent[] = [{ id: "ev1", title: "vs Eagles", date: "2026-08-15" }];
    const rows = buildScheduleRows([ex()], 2026, existing);
    expect(rows[0]!.matchId).toBe("ev1");
  });

  it("matching ignores case and extra whitespace, but not a different title or date", () => {
    const existing: ExistingEvent[] = [{ id: "ev1", title: "  VS   eagles ", date: "2026-08-15" }];
    expect(buildScheduleRows([ex()], 2026, existing)[0]!.matchId).toBe("ev1");

    const wrongDate: ExistingEvent[] = [{ id: "ev2", title: "vs Eagles", date: "2026-08-16" }];
    expect(buildScheduleRows([ex()], 2026, wrongDate)[0]!.matchId).toBeNull();

    const wrongTitle: ExistingEvent[] = [{ id: "ev3", title: "vs Hawks", date: "2026-08-15" }];
    expect(buildScheduleRows([ex()], 2026, wrongTitle)[0]!.matchId).toBeNull();
  });

  it("a re-upload of the same schedule matches every unchanged row, so nothing duplicates", () => {
    const existing: ExistingEvent[] = [
      { id: "ev1", title: "vs Eagles", date: "2026-08-15" },
      { id: "ev2", title: "Practice", date: "2026-08-12" },
    ];
    const rows = buildScheduleRows(
      [ex(), ex({ id: "x2", title: "Practice", month: 8, day: 12, start: "17:00" })],
      2026, existing,
    );
    expect(rows.map((r) => r.matchId)).toEqual(["ev1", "ev2"]);
  });
});

describe("normTitle", () => {
  it("collapses case and whitespace so matching is forgiving but not blind", () => {
    expect(normTitle("  VS   Eagles  ")).toBe(normTitle("vs eagles"));
    expect(normTitle("vs Eagles")).not.toBe(normTitle("vs Hawks"));
  });
});

// UP-CORE-11 (2026-09-05): a printed timetable is a weekly grid, and reading
// it as one week of dated events is what made "Bio Mon/Wed" fourteen rows a
// semester.
describe("the weekly grid the extractor can now see", () => {
  it("carries the repeat and its weekdays into the review rows", () => {
    const rows = buildScheduleRows(
      [ex({ title: "Bio", month: 5, day: 20, recurring: true, weekdays: [1, 3] })],
      2026,
      [],
    );
    expect(rows[0]).toMatchObject({ repeats: true, days: [1, 3] });
  });

  it("a one-off keeps its own day and does not repeat", () => {
    const rows = buildScheduleRows([ex({ month: 5, day: 20 })], 2026, []);
    // 2026-05-20 is a Wednesday.
    expect(rows[0]).toMatchObject({ repeats: false, days: [3] });
  });

  it("a weekday list alone is never a repeat: the model has to say so", () => {
    const parsed = parseScheduleExtract(JSON.stringify({
      events: [{ title: "Bio", month: 5, day: 20, year: 2026, start: "09:00", weekdays: [1, 3] }],
    }))!;
    expect(parsed[0]!.recurring).toBe(false);
    expect(parsed[0]!.weekdays).toEqual([1, 3]);
  });

  it("drops weekday numbers that are not weekdays", () => {
    const parsed = parseScheduleExtract(JSON.stringify({
      events: [{ title: "Bio", month: 5, day: 20, year: 2026, start: "09:00", recurring: true, weekdays: [1, 9, "x", 3, 3] }],
    }))!;
    expect(parsed[0]!.weekdays).toEqual([1, 3]);
  });
});

// "Team call tomorrow at 2pm for 30 minutes" came back as "Couldn't Find Any Events" on production (2026-10-13): the prompt never said what
// today was, so "tomorrow" was not a date the model could write down.
import { scheduleExtractPrompt, readPlainSentences } from "./scheduleExtract";

describe("the prompt carries today", () => {
  it("says today's weekday and date, and how to resolve a relative day and a length", () => {
    const p = scheduleExtractPrompt("2026-10-14");
    expect(p).toContain("Today is Wednesday, 2026-10-14.");
    expect(p).toMatch(/"tomorrow" is the day after/);
    expect(p).toMatch(/set end to start plus that length/);
  });
});

describe("a model reply in a looser shape still reads", () => {
  it("takes a whole date and a length", () => {
    const rows = parseScheduleExtract(JSON.stringify({ events: [{ title: "Team Call", date: "2026-10-15", start: "14:00", durationMin: 30 }] }))!;
    expect(rows[0]).toMatchObject({ title: "Team Call", month: 10, day: 15, year: 2026, start: "14:00", end: "14:30" });
  });
  it("takes a bare list", () => {
    const rows = parseScheduleExtract(JSON.stringify([{ title: "Dentist", month: 10, day: 16, start: "09:30" }]))!;
    expect(rows).toHaveLength(1);
  });
});

describe("plain sentences are events without the model", () => {
  const today = "2026-10-14"; // a Wednesday
  it("the sample that failed", () => {
    const rows = readPlainSentences("Team call tomorrow at 2pm for 30 minutes", today)!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Team call", month: 10, day: 15, year: 2026, start: "14:00", end: "14:30", recurring: false });
  });
  it("a weekday, a 24 hour time and hours", () => {
    const r = readPlainSentences("Dentist Friday 9:30am for 1 hour", today)![0]!;
    expect(r).toMatchObject({ title: "Dentist", month: 10, day: 16, start: "09:30", end: "10:30" });
    expect(readPlainSentences("Practice on Saturday at 15:00", today)![0]).toMatchObject({ title: "Practice", day: 17, start: "15:00" });
  });
  it("today, tonight, and next week's weekday", () => {
    expect(readPlainSentences("Dinner tonight at 7pm", today)![0]).toMatchObject({ title: "Dinner", day: 14, start: "19:00" });
    expect(readPlainSentences("Game next Wednesday at 6pm", today)![0]).toMatchObject({ month: 10, day: 21 });
  });
  it("a written date, with and without a year, rolling a past date to next year", () => {
    expect(readPlainSentences("Recital Nov 3 at 5pm", today)![0]).toMatchObject({ title: "Recital", month: 11, day: 3, year: 2026 });
    expect(readPlainSentences("Checkup 3/9", today)![0]).toMatchObject({ month: 3, day: 9, year: 2027, start: null });
  });
  it("one event per line, and a line with no day is skipped rather than guessed", () => {
    const rows = readPlainSentences("Standup tomorrow at 9am\nBring snacks\nReview Friday at 1pm", today)!;
    expect(rows.map((r) => r.title)).toEqual(["Standup", "Review"]);
  });
  it("noon and midnight", () => {
    expect(readPlainSentences("Lunch tomorrow at 12pm", today)![0]!.start).toBe("12:00");
    expect(readPlainSentences("Reset tomorrow at 12am", today)![0]!.start).toBe("00:00");
  });
  it("nothing to read is null", () => {
    expect(readPlainSentences("hello there", today)).toBeNull();
  });
});
