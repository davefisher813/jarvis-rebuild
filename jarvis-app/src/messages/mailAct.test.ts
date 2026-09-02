import { describe, it, expect } from "vitest";
import { readAct, actLabel, realDate, endOfAct, DEFAULT_MIN } from "./mailAct";

const TODAY = "2026-08-25";

// The three laws in mailAct.ts, one describe each. Everything here is a way
// the model can be wrong, because the model being wrong is the only failure
// mode that matters: a fabricated appointment lands in the one surface Dave
// trusts without checking it.

describe("law 1: never invent", () => {
  it("refuses a date that is not a real day", () => {
    expect(readAct({ kind: "appointment", title: "Video visit", date: "2026-02-31", start: "14:00" }, TODAY)).toBeNull();
    expect(realDate("2026-02-31")).toBe(false);
    expect(realDate("2026-02-28")).toBe(true);
  });

  it("refuses a date the model wrote in prose", () => {
    for (const d of ["Thursday", "Aug 27", "2026-8-27", "tomorrow", ""]) {
      expect(readAct({ kind: "appointment", title: "Visit", date: d, start: "14:00" }, TODAY), d).toBeNull();
    }
  });

  it("refuses a date in the past, and a date in an invented year", () => {
    expect(readAct({ kind: "appointment", title: "Visit", date: "2026-08-20", start: "14:00" }, TODAY)).toBeNull();
    expect(readAct({ kind: "appointment", title: "Visit", date: "2030-08-20", start: "14:00" }, TODAY)).toBeNull();
  });

  it("allows yesterday by one day, because mail sits overnight", () => {
    // Read at 7am, the reminder that arrived at 11pm is talking about a date
    // that turned over while it was in the inbox.
    expect(readAct({ kind: "delivery", title: "Package", date: "2026-08-24" }, TODAY)?.verb).toBe("remind");
  });

  it("refuses with no title, because a blank thing on the schedule is not a thing", () => {
    expect(readAct({ kind: "appointment", title: "   ", date: "2026-08-27", start: "14:00" }, TODAY)).toBeNull();
  });

  it("drops a time it cannot read rather than guessing one", () => {
    // Degrades to a reminder on the day. It does NOT become 09:00.
    const a = readAct({ kind: "appointment", title: "Video visit", date: "2026-08-27", start: "2pm" }, TODAY);
    expect(a?.verb).toBe("remind");
    expect(a?.start).toBeUndefined();
  });

  it("drops an amount that is not a number, or is absurd", () => {
    expect(readAct({ kind: "bill", title: "Internet", date: "2026-09-01", amount: "$74.99" }, TODAY)?.verb).toBe("remind");
    expect(readAct({ kind: "bill", title: "Internet", date: "2026-09-01", amount: 0 }, TODAY)?.verb).toBe("remind");
    expect(readAct({ kind: "bill", title: "Internet", date: "2026-09-01", amount: 8005551212 }, TODAY)?.verb).toBe("remind");
  });

  it("takes nothing at all from junk", () => {
    expect(readAct(null, TODAY)).toBeNull();
    expect(readAct(undefined, TODAY)).toBeNull();
    expect(readAct({}, TODAY)).toBeNull();
  });
});

describe("law 2: degrade, never upgrade", () => {
  it("an appointment with a time is a schedule action", () => {
    const a = readAct({ kind: "appointment", title: "Video visit", date: "2026-08-27", start: "14:00" }, TODAY);
    expect(a).toEqual({ verb: "schedule", title: "Video visit", date: "2026-08-27", start: "14:00", durationMin: DEFAULT_MIN });
    expect(actLabel(a!)).toBe("Schedule");
  });

  it("an appointment with no time is a reminder for that day", () => {
    const a = readAct({ kind: "appointment", title: "Annual physical", date: "2026-09-03" }, TODAY);
    expect(a?.verb).toBe("remind");
    expect(actLabel(a!)).toBe("Add Task");
  });

  it("a bill with an amount goes to Money; without one it is a reminder", () => {
    expect(actLabel(readAct({ kind: "bill", title: "Internet", date: "2026-09-01", amount: 74.99 }, TODAY)!)).toBe("Add Bill");
    expect(actLabel(readAct({ kind: "bill", title: "Internet", date: "2026-09-01" }, TODAY)!)).toBe("Add Task");
  });

  it("a package is a reminder even when it carries a time", () => {
    // A delivery window is not an appointment. Blocking two hours of his day
    // for a doorbell is the upgrade this law exists to prevent.
    const a = readAct({ kind: "delivery", title: "Nike order", date: "2026-08-27", start: "14:00" }, TODAY);
    expect(a?.verb).toBe("remind");
    expect(a?.start).toBeUndefined();
  });

  it("rounds a duration into a sane block and defaults only the duration", () => {
    expect(readAct({ kind: "meeting", title: "Call", date: "2026-08-27", start: "09:00", durationMin: 5 }, TODAY)?.durationMin).toBe(15);
    expect(readAct({ kind: "meeting", title: "Call", date: "2026-08-27", start: "09:00", durationMin: 900 }, TODAY)?.durationMin).toBe(480);
    expect(readAct({ kind: "meeting", title: "Call", date: "2026-08-27", start: "09:00" }, TODAY)?.durationMin).toBe(60);
  });
});

describe("law 3: a kind we do not know is not an action", () => {
  it("ignores a kind that is not on the list", () => {
    // Every newsletter on earth mentions a date.
    for (const k of ["newsletter", "sale", "update", "digest", "", "receipt"]) {
      expect(readAct({ kind: k, title: "Fall Sale Ends Friday", date: "2026-08-28" }, TODAY), k).toBeNull();
    }
  });
});

describe("the clock", () => {
  it("drops an appointment today whose time has already gone", () => {
    // 12:55 on his screenshot. A 9am appointment today is not something to
    // add, and there is no honest way to move it.
    expect(readAct({ kind: "appointment", title: "Video visit", date: TODAY, start: "09:00" }, TODAY, 775)).toBeNull();
    expect(readAct({ kind: "appointment", title: "Video visit", date: TODAY, start: "14:00" }, TODAY, 775)?.verb).toBe("schedule");
  });

  it("never lets a block cross midnight", () => {
    expect(endOfAct("23:40", 60)).toBe("23:59");
    expect(endOfAct("14:00", 30)).toBe("14:30");
  });
});
