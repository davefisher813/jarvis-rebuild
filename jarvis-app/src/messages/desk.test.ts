import { describe, it, expect, beforeEach } from "vitest";
import {
  loadDesk, setAtDesk, clearAtDesk, isAtDesk, deskCount, deskLine,
  dropAtDesk, deskRows, isDeskNow, minsOfDay, DESK_WIDE_MIN_PX, DESK_DEFAULT_END_MIN, KEY,
} from "./desk";

// UP-MIND-09. The two laws are what these tests are actually protecting:
// NEVER LOST (a set-aside thread is always countable and always comes back)
// and NEVER NAGGING (nothing here escalates, badges zero, or reorders itself
// into an urgency ladder).

function mem(): Pick<Storage, "getItem" | "setItem"> & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
  };
}

const T = (iso: string) => () => Date.parse(iso);

describe("desk store", () => {
  let s: ReturnType<typeof mem>;
  beforeEach(() => { s = mem(); });

  it("an empty or broken store reads as nothing set aside, never a throw", () => {
    expect(loadDesk(s)).toEqual({});
    s.data[KEY] = "not json";
    expect(loadDesk(s)).toEqual({});
    s.data[KEY] = '["an","array"]';
    expect(loadDesk(s)).toEqual({});
    s.data[KEY] = '{"t1":123,"t2":"2026-09-08T10:00:00.000Z"}';
    expect(loadDesk(s)).toEqual({ t2: "2026-09-08T10:00:00.000Z" });
  });

  it("sets a thread aside with the time it was set", () => {
    const m = setAtDesk("t1", T("2026-09-08T10:00:00Z"), s);
    expect(m).toEqual({ t1: "2026-09-08T10:00:00.000Z" });
    expect(isAtDesk("t1", m)).toBe(true);
    expect(isAtDesk("t2", m)).toBe(false);
  });

  // The timestamp answers "how long has this been waiting", and a second tap
  // on a thread already set aside is not a new wait.
  it("setting an already-set thread keeps the original time", () => {
    setAtDesk("t1", T("2026-09-08T10:00:00Z"), s);
    const again = setAtDesk("t1", T("2026-09-09T18:00:00Z"), s);
    expect(again.t1).toBe("2026-09-08T10:00:00.000Z");
  });

  it("clearing removes it, and clearing an absent thread is a no-op", () => {
    setAtDesk("t1", T("2026-09-08T10:00:00Z"), s);
    expect(deskCount(clearAtDesk("t1", s))).toBe(0);
    expect(clearAtDesk("nope", s)).toEqual({});
  });

  it("survives a round trip through storage", () => {
    setAtDesk("t1", T("2026-09-08T10:00:00Z"), s);
    setAtDesk("t2", T("2026-09-08T11:00:00Z"), s);
    expect(loadDesk(s)).toEqual({
      t1: "2026-09-08T10:00:00.000Z",
      t2: "2026-09-08T11:00:00.000Z",
    });
  });

  // NEVER NAGGING: a badge that reads 0 is a nag.
  it("the tab line is null at zero and counts otherwise", () => {
    expect(deskLine({})).toBeNull();
    expect(deskLine({ a: "2026-09-08T10:00:00.000Z" })).toBe("1 For a Desk");
    expect(deskLine({ a: "x", b: "y", c: "z", d: "w" })).toBe("4 For a Desk");
  });

  it("set-aside threads leave the phone view", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(dropAtDesk(rows, {})).toBe(rows);
    expect(dropAtDesk(rows, { b: "2026-09-08T10:00:00.000Z" })).toEqual([{ id: "a" }, { id: "c" }]);
  });

  // NEVER LOST: they come back together, and the one waiting longest is the
  // one most at risk of being forgotten, so it leads.
  it("the desk section is longest-waiting first", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const desk = {
      a: "2026-09-08T12:00:00.000Z",
      c: "2026-09-06T09:00:00.000Z",
    };
    expect(deskRows(rows, desk).map((r) => r.id)).toEqual(["c", "a"]);
    expect(deskRows(rows, {})).toEqual([]);
  });

  // The count is the honest number even when a row is not on the loaded page,
  // so nothing is ever claimed to be gone that is not.
  it("a set-aside thread the inbox no longer carries still counts", () => {
    const desk = { gone: "2026-09-06T09:00:00.000Z", here: "2026-09-07T09:00:00.000Z" };
    expect(deskRows([{ id: "here" }], desk).map((r) => r.id)).toEqual(["here"]);
    expect(deskCount(desk)).toBe(2);
    expect(deskLine(desk)).toBe("2 For a Desk");
  });
});

describe("is this a desk", () => {
  it("a wide screen is a desk at any hour", () => {
    expect(isDeskNow(DESK_WIDE_MIN_PX, 9 * 60)).toBe(true);
    expect(isDeskNow(DESK_WIDE_MIN_PX + 400, 2 * 60)).toBe(true);
  });

  it("a phone mid-workday is not", () => {
    expect(isDeskNow(390, 9 * 60)).toBe(false);
    expect(isDeskNow(390, DESK_DEFAULT_END_MIN - 1)).toBe(false);
  });

  it("a phone after the working day is", () => {
    expect(isDeskNow(390, DESK_DEFAULT_END_MIN)).toBe(true);
    expect(isDeskNow(390, 21 * 60)).toBe(true);
  });

  it("the routine's own work-end wins over the default", () => {
    // A person who stops at 3 gets their threads back at 3.
    expect(isDeskNow(390, 15 * 60, 15 * 60)).toBe(true);
    // A person who works till 8 is not handed a desk section at 5.
    expect(isDeskNow(390, 17 * 60, 20 * 60)).toBe(false);
  });

  // Local getters, never toISOString: the UTC day-math bug class this repo
  // has fixed repeatedly.
  it("minsOfDay reads the local clock", () => {
    expect(minsOfDay(new Date(2026, 8, 8, 0, 0))).toBe(0);
    expect(minsOfDay(new Date(2026, 8, 8, 17, 30))).toBe(17 * 60 + 30);
    expect(minsOfDay(new Date(2026, 8, 8, 23, 59))).toBe(23 * 60 + 59);
  });
});
