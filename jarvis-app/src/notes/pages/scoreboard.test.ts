import { describe, it, expect } from "vitest";
import {
  SPORTS, newScoreboardPage, bowlingFrames, bKey, dKey, dartTurns, dartsLeft, sideTotal, scoreStanding, setPeriodScore, setCell, periodsWon, setSport, sportChangeImpact, nextPeriod, pinsLeft, addPeriod,
} from "./scoreboard";
import type { PageData, PageRecord } from "./pageModel";

const bowl = (rolls: number[]): PageRecord => {
  const v: Record<string, string> = { name: "A" };
  let i = 0;
  for (let f = 1; f <= 10; f++) {
    const a = rolls[i++];
    if (a === undefined) break;
    v[bKey(f, "a")] = String(a);
    if (f < 10 && a === 10) continue;
    const b = rolls[i++];
    if (b === undefined) break;
    v[bKey(f, "b")] = String(b);
    if (f === 10 && (a === 10 || a + b === 10)) { const c = rolls[i++]; if (c !== undefined) v[bKey(f, "c")] = String(c); }
  }
  return { id: "r1", v };
};
const total = (rolls: number[]) => bowlingFrames(bowl(rolls)).reduce((last, f) => (f.total !== null ? f.total : last), 0);

describe("the sport index", () => {
  it("has the whole index, each with a way to score it", () => {
    expect(SPORTS.map((s) => s.key)).toEqual(expect.arrayContaining(["basketball", "football", "soccer", "hockey", "baseball", "softball", "volleyball", "tennis", "pickleball", "cornhole", "bowling", "darts501", "gamenight", "trivia"]));
    expect(new Set(SPORTS.map((s) => s.key)).size).toBe(SPORTS.length);
    for (const s of SPORTS) expect(["periods", "target", "bowling", "countdown"]).toContain(s.mode);
  });
});

describe("bowling: the real scoring", () => {
  it("a perfect game is 300", () => expect(total(Array(12).fill(10))).toBe(300));
  it("an open game adds the pins", () => expect(total([3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3, 4])).toBe(70));
  it("all spares of 5 with a 5 to finish is 150", () => expect(total(Array(21).fill(5))).toBe(150));
  it("a strike waits for its next two rolls, a spare for its next one", () => {
    const fr = bowlingFrames(bowl([10, 7, 3, 9, 0]));
    expect(fr[0]!.total).toBe(20);   // 10 + 7 + 3
    expect(fr[1]!.total).toBe(39);   // + (7 + 3 + 9)
    expect(fr[2]!.total).toBe(48);
    expect(bowlingFrames(bowl([10]))[0]!.total).toBeNull(); // nothing to add yet
    expect(bowlingFrames(bowl([7, 3]))[0]!.total).toBeNull();
  });
  it("marks strikes and spares", () => {
    const fr = bowlingFrames(bowl([10, 7, 3]));
    expect(fr[0]!.mark).toBe("X");
    expect(fr[1]!.mark).toBe("/");
  });
  it("never offers an impossible roll", () => {
    const r = bowl([4]);
    expect(pinsLeft(r, 1, "a")).toBe(10);
    expect(pinsLeft(r, 1, "b")).toBe(6);
    expect(pinsLeft(bowl(Array(9).fill(10)), 10, "b")).toBe(10);
  });
});

describe("darts: down to exactly zero, a bust does not count", () => {
  const page = (): PageData => newScoreboardPage("darts501", ["A", "B"], "2026-10-14");
  it("counts down", () => {
    let p = page();
    p = setCell(p, p.records[0]!.id, dKey(1), 60);
    p = setCell(p, p.records[0]!.id, dKey(2), 100);
    expect(dartsLeft(p, p.records[0]!)).toBe(341);
  });
  it("a turn that would go under zero is a bust and changes nothing", () => {
    let p = newScoreboardPage("darts301", ["A"], "2026-10-14");
    const id = p.records[0]!.id;
    for (const [t, s] of [[1, 180], [2, 100], [3, 30]] as const) p = setCell(p, id, dKey(t), s);
    // 301 - 180 = 121; 100 -> 21; 30 would go under: bust.
    const turns = dartTurns(p, p.records[0]!);
    expect(turns.map((x) => x.bust)).toEqual([false, false, true]);
    expect(dartsLeft(p, p.records[0]!)).toBe(21);
    p = setCell(p, id, dKey(4), 21);
    expect(dartsLeft(p, p.records[0]!)).toBe(0);
    expect(scoreStanding(p)[0]!.done).toBe(true);
  });
  it("the lower number is ahead", () => {
    let p = page();
    p = setCell(p, p.records[0]!.id, dKey(1), 100);
    const s = scoreStanding(p);
    expect(s.find((x) => x.leading)?.name).toBe("A");
  });
});

describe("periods and sets", () => {
  it("adds the columns, ranks the totals and says who leads", () => {
    let p = newScoreboardPage("basketball", ["Home", "Away"], "2026-10-14");
    const [h, a] = p.records;
    for (const [n, hs, as] of [[1, 20, 18], [2, 15, 22], [3, 30, 25], [4, 10, 12]] as const) { p = setPeriodScore(p, h!.id, n, hs); p = setPeriodScore(p, a!.id, n, as); }
    expect(sideTotal(p, p.records[0]!)).toBe(75);
    expect(sideTotal(p, p.records[1]!)).toBe(77);
    expect(scoreStanding(p).find((x) => x.leading)?.name).toBe("Away");
    expect(nextPeriod(p)).toBe(4);
  });
  it("a set sport ranks by sets won, not by total points", () => {
    let p = newScoreboardPage("volleyball", ["A", "B"], "2026-10-14");
    const [a, b] = p.records;
    for (const [n, x, y] of [[1, 25, 20], [2, 18, 25], [3, 25, 23]] as const) { p = setPeriodScore(p, a!.id, n, x); p = setPeriodScore(p, b!.id, n, y); }
    expect(periodsWon(p, p.records[0]!)).toBe(2);
    expect(scoreStanding(p).find((x) => x.leading)?.name).toBe("A");
  });
  it("an extra inning is one more column, and keeps every score", () => {
    let p = newScoreboardPage("baseball", undefined, "2026-10-14");
    p = setPeriodScore(p, p.records[0]!.id, 9, 3);
    p = addPeriod(p);
    expect(p.score!.periods).toBe(10);
    expect(p.records[0]!.v.p9).toBe("3");
  });
  it("a target game is done at its target", () => {
    let p = newScoreboardPage("pickleball", ["A", "B"], "2026-10-14");
    p = setPeriodScore(p, p.records[0]!.id, 1, 11);
    expect(scoreStanding(p)[0]!.done).toBe(true);
  });
});

describe("changing the sport never discards a score", () => {
  it("says how many scores stop showing, and switching back brings them all back", () => {
    let p = newScoreboardPage("baseball", ["A", "B"], "2026-10-14");
    p = setPeriodScore(p, p.records[0]!.id, 7, 4);
    expect(sportChangeImpact(p, "basketball")).toBe(1); // inning 7 has no quarter 7
    const bb = setSport(p, "basketball");
    expect(bb.score!.periods).toBe(4);
    expect(bb.records[0]!.v.p7).toBe("4");
    const back = setSport(bb, "baseball");
    expect(back.score!.periods).toBe(9);
    expect(sideTotal(back, back.records[0]!)).toBe(4);
  });
  it("moving to bowling hides period scores without touching them", () => {
    let p = newScoreboardPage("basketball", ["A"], "2026-10-14");
    p = setPeriodScore(p, p.records[0]!.id, 1, 20);
    expect(sportChangeImpact(p, "bowling")).toBe(1);
    expect(setSport(p, "bowling").records[0]!.v.p1).toBe("20");
  });
});
