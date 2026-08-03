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
