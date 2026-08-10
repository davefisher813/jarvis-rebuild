import { describe, it, expect } from "vitest";
import { birthdaysOn } from "./birthdays";
import type { Person } from "./types";

const person = (id: string, name: string, birthday?: string): Person =>
  ({ id, data: { name, group: "contacts", birthday } }) as Person;

describe("birthdaysOn", () => {
  it("matches month-day regardless of stored year, sorted by name", () => {
    const hits = birthdaysOn(
      [person("1", "Mike", "1988-08-03"), person("2", "Ana", "2001-08-03"), person("3", "Sam", "1990-12-25")],
      "2026-08-03",
    );
    expect(hits.map((h) => h.name)).toEqual(["Ana", "Mike"]);
  });

  it("accepts a yearless MM-DD birthday (contact imports)", () => {
    expect(birthdaysOn([person("1", "Mike", "08-03")], "2026-08-03")).toHaveLength(1);
    expect(birthdaysOn([person("1", "Mike", "08-03")], "2026-08-04")).toHaveLength(0);
  });

  it("accepts the Person sheet's own suggested format: month-name day", () => {
    // the sheet placeholder literally says "e.g. March 4"; that MUST work
    const ppl = [person("1", "A", "August 3"), person("2", "B", "august 3rd"), person("3", "C", "Aug 3"), person("4", "D", "March 4")];
    expect(birthdaysOn(ppl, "2026-08-03").map((h) => h.name)).toEqual(["A", "B", "C"]);
  });

  it("REJECTS ambiguous or malformed dates: better no greeting than the wrong day", () => {
    const ppl = [person("1", "A"), person("2", "B", "8/3"), person("3", "C", "2026-8-3"), person("4", "D", ""), person("5", "E", "Wugust 3")];
    expect(birthdaysOn(ppl, "2026-08-03")).toHaveLength(0);
  });

  it("empty on a day with no birthdays (the normal state)", () => {
    expect(birthdaysOn([person("1", "Mike", "1988-08-03")], "2026-09-01")).toHaveLength(0);
  });
});

// Upcoming birthdays (2026-08-10): the people-kind category page's window.
import { upcomingBirthdays } from "./birthdays";

describe("upcomingBirthdays", () => {
  const person = (id: string, name: string, birthday?: string) =>
    ({ id, data: { name, group: "contacts" as const, birthday } });

  it("returns birthdays inside the window, sorted soonest first, labeled", () => {
    const out = upcomingBirthdays([
      person("a", "Mom", "1958-08-24"),
      person("b", "Sam", "08-12"),
      person("c", "Far", "12-25"),
      person("d", "NoBday"),
    ], "2026-08-10");
    expect(out.map((x) => x.id)).toEqual(["b", "a"]);
    expect(out[0]).toMatchObject({ name: "Sam", inDays: 2, label: "Aug 12" });
    expect(out[1]).toMatchObject({ name: "Mom", inDays: 14, label: "Aug 24" });
  });

  it("labels today and tomorrow in words", () => {
    const out = upcomingBirthdays([
      person("a", "A", "08-10"),
      person("b", "B", "08-11"),
    ], "2026-08-10");
    expect(out[0]!.label).toBe("Today");
    expect(out[1]!.label).toBe("Tomorrow");
  });

  it("wraps the year: late December sees early January", () => {
    const out = upcomingBirthdays([person("a", "NYE Kid", "01-02")], "2026-12-27");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ inDays: 6, label: "Jan 2" });
  });

  it("free-text months work through the same parser as the day-of view", () => {
    const out = upcomingBirthdays([person("a", "A", "August 24")], "2026-08-10");
    expect(out[0]).toMatchObject({ label: "Aug 24" });
  });
});
