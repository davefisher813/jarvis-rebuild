import { describe, it, expect, vi } from "vitest";
import { isDate, tidy, dayOffLabel, readDaysOff, saveDaysOff } from "./daysOff";

// DAYS HE IS NOT AVAILABLE (Track 3, 2026-09-19).
//
// The grid honoured a blocked day from the start and nothing ever wrote one, so
// a holiday could not be said: he sets Monday to Friday, goes away for a week,
// and the link hands that week out.

const tok = async () => "session-token";
const answering = (body: unknown, status = 200) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

describe("isDate", () => {
  it("accepts a day in the form the store and the server both use", () => {
    expect(isDate("2026-12-25")).toBe(true);
  });
  it("rejects anything that is not one, including a plausible near miss", () => {
    for (const bad of ["", "25/12/2026", "2026-13-01", "2026-02-30", "2026-1-1", "tomorrow"]) {
      expect(isDate(bad), bad).toBe(false);
    }
  });
});

describe("tidy", () => {
  it("sorts, so the screen is right the moment he adds one", () => {
    expect(tidy(["2026-12-25", "2026-01-02", "2026-06-15"]))
      .toEqual(["2026-01-02", "2026-06-15", "2026-12-25"]);
  });
  it("keeps one copy of a day added twice", () => {
    expect(tidy(["2026-12-25", "2026-12-25"])).toEqual(["2026-12-25"]);
  });
  it("drops anything that is not a day rather than storing it", () => {
    expect(tidy(["2026-12-25", "nope", "", "2026-13-01"])).toEqual(["2026-12-25"]);
  });
});

describe("dayOffLabel", () => {
  const NOW = new Date("2026-06-01T12:00:00");

  it("reads the day the way somebody says it", () => {
    expect(dayOffLabel("2026-12-25", NOW)).toBe("Friday, December 25");
  });
  // The year is noise until it is not: a day off next January needs it, one this
  // December does not.
  it("adds the year only when the day is not in this one", () => {
    expect(dayOffLabel("2027-01-04", NOW)).toContain("2027");
    expect(dayOffLabel("2026-12-25", NOW)).not.toContain("2026");
  });
  it("shows the raw value rather than Invalid Date when it cannot read it", () => {
    expect(dayOffLabel("nonsense", NOW)).toBe("nonsense");
  });
});

describe("readDaysOff", () => {
  it("asks with the session token and tidies the answer", async () => {
    const f = answering({ daysOff: ["2026-12-25", "2026-01-02", "2026-01-02"] });
    expect(await readDaysOff(f, tok)).toEqual(["2026-01-02", "2026-12-25"]);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
  });
  // Not knowing and having none are different facts, and a screen that reads the
  // first as the second tells him his calendar is open when it may not be.
  it("is null, not empty, when there is no way to ask", async () => {
    expect(await readDaysOff(answering({}), async () => null)).toBeNull();
    expect(await readDaysOff(answering({}, 503), tok)).toBeNull();
    expect(await readDaysOff((() => { throw new Error("offline"); }) as unknown as typeof fetch, tok)).toBeNull();
    expect(await readDaysOff(answering({ daysOff: "nope" }), tok)).toBeNull();
  });
});

describe("saveDaysOff", () => {
  it("sends the whole list, tidied, because the table means what the screen shows", async () => {
    const f = answering({ daysOff: ["2026-01-02", "2026-12-25"] });
    expect(await saveDaysOff(["2026-12-25", "2026-01-02", "junk"], f, tok))
      .toEqual(["2026-01-02", "2026-12-25"]);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ daysOff: ["2026-01-02", "2026-12-25"] });
  });

  // Clearing the last one is a real instruction, not a no-op to skip.
  it("sends an empty list rather than skipping the call", async () => {
    const f = answering({ daysOff: [] });
    expect(await saveDaysOff([], f, tok)).toEqual([]);
    expect(JSON.parse(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string))
      .toEqual({ daysOff: [] });
  });

  // A person who has just marked next week off must not be left believing it.
  it("throws when it did not save", async () => {
    await expect(saveDaysOff(["2026-12-25"], answering({}, 502), tok)).rejects.toBeTruthy();
    await expect(saveDaysOff(["2026-12-25"], answering({}), async () => null)).rejects.toBeTruthy();
  });

  it("falls back to what it sent when the server answers without a list", async () => {
    expect(await saveDaysOff(["2026-12-25"], answering({}), tok)).toEqual(["2026-12-25"]);
  });
});
