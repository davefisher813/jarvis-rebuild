import { describe, it, expect } from "vitest";
import { parseSyllabusExtract, buildSyllabusRows, toISODate, rowLine, type ExtractedSyllabusItem } from "./syllabusExtract";

const ex = (over: Partial<ExtractedSyllabusItem> = {}): ExtractedSyllabusItem =>
  ({ id: "s1", title: "Essay 1", kind: "task", month: 9, day: 15, year: 2026, start: null, weight: null, ...over });

// UP-CORE-12 (2026-09-05): a photographed syllabus is a semester of work in
// one page. The app could read a schedule photo and a gym program; the shape
// that produces TASKS had no extractor at all. Nothing here is guessed: the
// three refusals are the schedule upload's, for the same reason.
describe("parseSyllabusExtract", () => {
  it("reads assignments as tasks and exams as events", () => {
    const out = parseSyllabusExtract(JSON.stringify({
      items: [
        { title: "Essay 1", kind: "task", month: 9, day: 15, year: 2026, weight: "20%" },
        { title: "Midterm", kind: "event", month: 10, day: 2, year: 2026, start: "14:00" },
      ],
    }))!;
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: "Essay 1", kind: "task", month: 9, day: 15, weight: "20%" });
    expect(out[1]).toMatchObject({ title: "Midterm", kind: "event", start: "14:00" });
  });

  it("keeps an undated row undated rather than dating it", () => {
    const out = parseSyllabusExtract(JSON.stringify({
      items: [{ title: "Read as we go", kind: "task", month: null, day: null }],
    }))!;
    expect(out[0]).toMatchObject({ month: null, day: null });
    // Half a date is no date: a month with no day cannot be written down.
    const half = parseSyllabusExtract(JSON.stringify({ items: [{ title: "X", month: 9 }] }))!;
    expect(half[0]).toMatchObject({ month: null, day: null });
  });

  it("anything not called an event is a task, which is the reversible read", () => {
    const out = parseSyllabusExtract(JSON.stringify({ items: [{ title: "X", kind: "quiz" }] }))!;
    expect(out[0]!.kind).toBe("task");
  });

  it("drops a row with no title, and refuses junk outright", () => {
    expect(parseSyllabusExtract(JSON.stringify({ items: [{ month: 9, day: 1 }] }))).toBeNull();
    expect(parseSyllabusExtract("not json")).toBeNull();
  });

  it("reads through a code fence, the way the other extractors do", () => {
    const out = parseSyllabusExtract("```json\n" + JSON.stringify({ items: [{ title: "Essay", kind: "task" }] }) + "\n```")!;
    expect(out[0]!.title).toBe("Essay");
  });
});

describe("buildSyllabusRows", () => {
  it("resolves the year only where the source left one out", () => {
    const rows = buildSyllabusRows([ex(), ex({ id: "s2", year: null })], 2027);
    expect(rows[0]!.date).toBe("2026-09-15");
    expect(rows[1]!.date).toBe("2027-09-15");
  });

  it("flags an undated row and keeps it, because the assignment is real", () => {
    const rows = buildSyllabusRows([ex({ month: null, day: null })], 2026);
    expect(rows[0]).toMatchObject({ noDate: true, date: "" });
  });

  it("a date that is not a real date is left undated, never rolled forward", () => {
    expect(toISODate(2026, 2, 30)).toBeNull();
    const rows = buildSyllabusRows([ex({ month: 2, day: 30 })], 2026);
    expect(rows[0]!.noDate).toBe(true);
  });

  it("the review line states the read, and the weight is the syllabus's own claim", () => {
    const word = (iso: string) => iso;
    expect(rowLine(buildSyllabusRows([ex({ weight: "20%" })], 2026)[0]!, word)).toBe("Task · 2026-09-15 · 20%");
    expect(rowLine(buildSyllabusRows([ex({ kind: "event", start: "14:00" })], 2026)[0]!, word)).toBe("Event · 2026-09-15 · 14:00");
    expect(rowLine(buildSyllabusRows([ex({ month: null, day: null })], 2026)[0]!, word)).toBe("Task · No date found");
  });
});
