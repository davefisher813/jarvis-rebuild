import { describe, it, expect } from "vitest";
import {
  SPORTS, newScoreboardPage, bowlingFrames, bKey, dKey, dartTurns, dartsLeft, sideTotal, scoreStanding, setPeriodScore, setCell, periodsWon, setSport, sportChangeImpact, nextPeriod, pinsLeft, addPeriod,
  diceTotals, DICE_BOXES, PHASE_KEY, phaseOf, columnName, sideScored,
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
    for (const s of SPORTS) expect(["periods", "target", "bowling", "countdown", "dice"]).toContain(s.mode);
  });
  it("has the Game Night sheets the 2026-10-13 spec names, each on the Game Night shelf", () => {
    for (const k of ["hearts", "spades", "euchre", "rummy", "phase10", "dice", "farkle", "trivia"]) expect(SPORTS.find((s) => s.key === k)?.group, k).toBe("Game Night");
  });
});

// THE GAME NIGHT SHEETS, scored the way their players score them (the 2026-10-13 spec: "Game Night mode incl. Hearts/Spades/Euchre/
// Rummy/Phase 10/dice sheets").
describe("Hearts: lowest wins, over at 100", () => {
  const two = () => newScoreboardPage("hearts", ["A", "B"], "2026-10-17");
  it("nobody leads before a hand; after one, the lowest total leads", () => {
    let p = two();
    expect(scoreStanding(p).some((s) => s.leading)).toBe(false);
    p = setPeriodScore(p, p.records[0]!.id, 1, 13);
    // B has no hand yet: not ahead for having nothing.
    expect(scoreStanding(p).find((s) => s.name === "B")!.leading).toBe(false);
    p = setPeriodScore(p, p.records[1]!.id, 1, 0);
    expect(scoreStanding(p).find((s) => s.name === "B")!.leading).toBe(true);
    expect(scoreStanding(p).find((s) => s.name === "A")!.leading).toBe(false);
  });
  it("the hand a side reaches 100 ends it, and the lowest total has won", () => {
    let p = two();
    for (let h = 1; h <= 4; h++) { p = setPeriodScore(p, p.records[0]!.id, h, 26); p = setPeriodScore(p, p.records[1]!.id, h, 0); }
    const st = scoreStanding(p);
    expect(st.find((s) => s.name === "A")).toMatchObject({ value: 104, won: false, leading: false });
    expect(st.find((s) => s.name === "B")).toMatchObject({ value: 0, won: true });
    expect(p.score!.endAt).toBe(100);
    expect(p.score!.lowWins).toBe(true);
  });
});

describe("Spades and Rummy: to 500, a hand can go below zero", () => {
  it("a failed bid is a negative hand and the total follows it", () => {
    let p = newScoreboardPage("spades", undefined, "2026-10-17");
    expect(p.records.map((r) => r.v.name)).toEqual(["Us", "Them"]);
    p = setPeriodScore(p, p.records[0]!.id, 1, -50);
    expect(sideTotal(p, p.records[0]!)).toBe(-50);
    expect(p.score!.min).toBe(-500);
    p = setPeriodScore(p, p.records[1]!.id, 1, 60);
    expect(scoreStanding(p).find((s) => s.name === "Them")!.leading).toBe(true);
  });
  it("first to 500 has won", () => {
    let p = newScoreboardPage("rummy", ["A", "B"], "2026-10-17");
    p = setPeriodScore(p, p.records[0]!.id, 1, 505);
    p = setPeriodScore(p, p.records[1]!.id, 1, 120);
    expect(scoreStanding(p).find((s) => s.name === "A")!.won).toBe(true);
    expect(p.score!.step).toBe(5);
  });
});

describe("Euchre and Farkle: one running score to a target", () => {
  it("Euchre is to 10 for Us and Them; Farkle is to 10,000 in fifties", () => {
    const e = newScoreboardPage("euchre", undefined, "2026-10-17");
    expect(e.score).toMatchObject({ mode: "target", target: 10 });
    expect(e.records.map((r) => r.v.name)).toEqual(["Us", "Them"]);
    const f = newScoreboardPage("farkle", undefined, "2026-10-17");
    expect(f.score).toMatchObject({ mode: "target", target: 10000, step: 50, max: 20000 });
    const done = setPeriodScore(f, f.records[0]!.id, 1, 10050);
    expect(scoreStanding(done)[0]!.done).toBe(true);
  });
});

describe("Phase 10: points are bad, the tenth phase ends it", () => {
  it("the lowest points lead; the first to finish phase 10 ends the game, fewest points among them wins", () => {
    let p = newScoreboardPage("phase10", ["A", "B"], "2026-10-17");
    expect(p.score!.phase).toBe(true);
    p = setPeriodScore(p, p.records[0]!.id, 1, 50);
    p = setPeriodScore(p, p.records[1]!.id, 1, 0);
    expect(scoreStanding(p).find((s) => s.name === "B")!.leading).toBe(true);
    p = setCell(p, p.records[0]!.id, PHASE_KEY, 10);
    const st = scoreStanding(p);
    // A finished the phases, B did not: A has won even with more points, since only finishers are weighed.
    expect(st.find((s) => s.name === "A")).toMatchObject({ phase: 10, won: true });
    expect(st.find((s) => s.name === "B")).toMatchObject({ phase: 0, won: false, leading: false });
    expect(phaseOf(p.records[0]!)).toBe(10);
    // Both finish: the fewer points win.
    p = setCell(p, p.records[1]!.id, PHASE_KEY, 10);
    expect(scoreStanding(p).find((s) => s.name === "B")!.won).toBe(true);
  });
  it("leaving Phase 10 for another game says the phase stops showing", () => {
    let p = newScoreboardPage("phase10", ["A"], "2026-10-17");
    p = setCell(p, p.records[0]!.id, PHASE_KEY, 3);
    expect(sportChangeImpact(p, "gamenight")).toBe(1);
    expect(setSport(p, "gamenight").score!.phase).toBeUndefined();
  });
});

describe("the dice sheet: thirteen boxes, the upper bonus, the Yahtzee bonus", () => {
  const sheet = (v: Record<string, string>): PageRecord => ({ id: "r1", v: { name: "A", ...v } });
  it("adds the upper six, 35 more at 63, then the lower boxes", () => {
    const upper63 = { y1: "3", y2: "6", y3: "9", y4: "12", y5: "15", y6: "18" };   // three of each: exactly 63
    expect(diceTotals(sheet(upper63))).toMatchObject({ upper: 63, bonus: 35, total: 98, filled: 6, done: false });
    expect(diceTotals(sheet({ ...upper63, y6: "12" })).bonus).toBe(0);
    const full = { ...upper63, y7: "20", y8: "25", y9: "25", y10: "30", y11: "40", y12: "50", y13: "22" };
    const t = diceTotals(sheet(full));
    expect(t).toMatchObject({ lower: 212, total: 63 + 35 + 212, filled: 13, done: true });
    expect(diceTotals(sheet({ ...full, y14: "200" })).total).toBe(63 + 35 + 212 + 200);
  });
  it("a scratch is a zero and counts as played; an empty box does not", () => {
    expect(diceTotals(sheet({ y9: "0" })).filled).toBe(1);
    expect(diceTotals(sheet({})).filled).toBe(0);
  });
  it("every box moves by its own step so no impossible score can be entered", () => {
    expect(DICE_BOXES.find((b) => b.name === "Full House")).toMatchObject({ step: 25, max: 25 });
    expect(DICE_BOXES.find((b) => b.name === "Twos")).toMatchObject({ step: 2, max: 10 });
    expect(DICE_BOXES.find((b) => b.name === "Yahtzee")).toMatchObject({ step: 50, max: 50 });
    expect(DICE_BOXES).toHaveLength(14);
  });
  it("the page walks the boxes in order and the game is over when every sheet is full", () => {
    let p = newScoreboardPage("dice", ["A"], "2026-10-17");
    expect(columnName(p.score!, 1)).toBe("Ones");
    expect(columnName(p.score!, 9)).toBe("Full House");
    expect(nextPeriod(p)).toBe(1);
    p = setCell(p, p.records[0]!.id, "y1", 3);
    expect(nextPeriod(p)).toBe(2);
    for (const b of DICE_BOXES.slice(0, 13)) p = setCell(p, p.records[0]!.id, b.key, 0);
    expect(scoreStanding(p)[0]).toMatchObject({ done: true, won: true });
    expect(sideScored(p, p.records[0]!)).toBe(true);
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
