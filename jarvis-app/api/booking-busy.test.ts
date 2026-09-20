import { describe, it, expect } from "vitest";
import { rowsFrom, daysOffFrom } from "./booking-busy";

// THE HOURS THE OWNER HAS SPOKEN FOR (Track 3, 2026-09-19).
//
// Everything this endpoint writes is a claim that an hour is not free. A bad row
// either blocks an hour that IS free or fails to block one that is not, and both
// are silent until somebody turns up to an empty room. So the filter is the part
// worth pinning.

const OWNER = "u-1";

describe("rowsFrom", () => {
  it("writes a blocked row that names the window, which is what makes it an hour and not a day", () => {
    expect(rowsFrom([{ date: "2026-09-22", startTime: "14:00", endTime: "15:00" }], OWNER)).toEqual([
      { owner_id: OWNER, the_date: "2026-09-22", is_blocked: true, override_start: "14:00", override_end: "15:00" },
    ]);
  });

  it("stamps the caller as the owner, whatever the request claims", () => {
    const rows = rowsFrom([{ date: "2026-09-22", startTime: "14:00", endTime: "15:00", owner_id: "somebody-else" }], OWNER);
    expect(rows[0]!.owner_id).toBe(OWNER);
  });

  it("drops a window that is not a window", () => {
    expect(rowsFrom([
      { date: "2026-09-22", startTime: "15:00", endTime: "14:00" },
      { date: "2026-09-22", startTime: "14:00", endTime: "14:00" },
      { date: "2026-09-22", startTime: "25:00", endTime: "26:00" },
      { date: "2026-09-22", startTime: "2pm", endTime: "3pm" },
      { date: "2026-09-22", startTime: "14:00" },
    ], OWNER)).toEqual([]);
  });

  it("drops anything that is not a day", () => {
    expect(rowsFrom([
      { date: "22/09/2026", startTime: "14:00", endTime: "15:00" },
      { date: "", startTime: "14:00", endTime: "15:00" },
      { date: 20260922, startTime: "14:00", endTime: "15:00" },
      { startTime: "14:00", endTime: "15:00" },
    ], OWNER)).toEqual([]);
  });

  it("is empty for anything that is not a list at all", () => {
    expect(rowsFrom(undefined, OWNER)).toEqual([]);
    expect(rowsFrom(null, OWNER)).toEqual([]);
    expect(rowsFrom("blocks", OWNER)).toEqual([]);
    expect(rowsFrom({ date: "2026-09-22" }, OWNER)).toEqual([]);
  });

  it("writes the same window once, however many times it was sent", () => {
    const one = { date: "2026-09-22", startTime: "14:00", endTime: "15:00" };
    expect(rowsFrom([one, { ...one }, { ...one }], OWNER)).toHaveLength(1);
  });

  // A cap at all, because this writes as many rows as it is handed, and "as many
  // as it is handed" is not a number anybody chose.
  it("refuses to write an unbounded number of rows", () => {
    const many = Array.from({ length: 900 }, (_, i) => ({
      date: "2026-09-22", startTime: "00:00", endTime: `${String(Math.floor(i / 60) % 24).padStart(2, "0")}:59`,
    }));
    expect(rowsFrom(many, OWNER).length).toBeLessThanOrEqual(500);
  });

  it("keeps the good rows out of a batch that also holds bad ones", () => {
    const rows = rowsFrom([
      { date: "2026-09-22", startTime: "09:00", endTime: "10:00" },
      { date: "nope", startTime: "09:00", endTime: "10:00" },
      { date: "2026-09-23", startTime: "11:00", endTime: "12:00" },
    ], OWNER);
    expect(rows.map((r) => r.the_date)).toEqual(["2026-09-22", "2026-09-23"]);
  });

  // Every row it writes says blocked. A row that did not would narrow his day to
  // that window instead of taking the hour out of it, which is the opposite.
  it("never writes an unblocked row, which would mean the opposite", () => {
    const rows = rowsFrom([{ date: "2026-09-22", startTime: "14:00", endTime: "15:00" }], OWNER);
    expect(rows.every((r) => r.is_blocked === true)).toBe(true);
  });
});

describe("daysOffFrom", () => {
  it("sorts and dedupes, because the screen shows them in order", () => {
    expect(daysOffFrom(["2026-12-25", "2026-01-02", "2026-12-25"]))
      .toEqual(["2026-01-02", "2026-12-25"]);
  });

  // THE ROUND TRIP IS THE CHECK. Date.parse accepts the 30th of February and
  // rolls it to March 2, so a day that is not a day would take the WRONG day out
  // of his calendar with nothing looking wrong.
  it("refuses a day that does not exist, rather than rolling it forward", () => {
    expect(daysOffFrom(["2026-02-30"])).toEqual([]);
    expect(daysOffFrom(["2026-13-01"])).toEqual([]);
    expect(daysOffFrom(["2026-04-31"])).toEqual([]);
  });
  it("accepts a leap day in a leap year and refuses it in an ordinary one", () => {
    expect(daysOffFrom(["2028-02-29"])).toEqual(["2028-02-29"]);
    expect(daysOffFrom(["2026-02-29"])).toEqual([]);
  });

  it("is empty for anything that is not a list of days", () => {
    expect(daysOffFrom(undefined)).toEqual([]);
    expect(daysOffFrom("2026-12-25")).toEqual([]);
    expect(daysOffFrom([20261225, null, { date: "2026-12-25" }])).toEqual([]);
  });

  it("refuses to write an unbounded number of rows", () => {
    const many = Array.from({ length: 900 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
    expect(daysOffFrom(many).length).toBeLessThanOrEqual(400);
  });
});

describe("the two kinds of row stay apart", () => {
  // They share a table and the one difference between them is the window. A busy
  // push that cleared his holidays, or a holiday that dropped his hours, would
  // both be silent.
  it("a busy row always names a window and a day off never does", () => {
    const busy = rowsFrom([{ date: "2026-12-25", startTime: "09:00", endTime: "10:00" }], OWNER);
    expect(busy[0]!.override_start).toBe("09:00");
    expect(daysOffFrom(["2026-12-25"])).toEqual(["2026-12-25"]);
  });
});
