import { describe, it, expect } from "vitest";
import { newScorecardPage, setScore, setValues, newId, type PageData } from "./pageModel";
import { newTemplatePage } from "./templateDefs";
import {
  setHolePar, setStat, puttKey, fairKey, penKey, sandKey, statsOf, parOf, parsComplete, strokesOn, stablefordOn, girOn, playerRound, matchState,
  roundStory, winnerLine, roundRows, withRounds, rememberCourse, readCourseBook, findCourse, applyCourse, isFinished,
} from "./golf";
import { siProblem } from "./PageSheets";

const FOURS = Array.from({ length: 18 }, () => 4);
const round = (players: string[], extra: Partial<Parameters<typeof newScorecardPage>[0]> = {}): PageData => newScorecardPage({ course: "Pebble", players, date: "2026-10-23", ...extra });
const play = (p: PageData, i: number, scores: number[]) => scores.reduce((acc, s, h) => setScore(acc, acc.records[i]!.id, h + 1, s), p);

describe("golf: pars are real or absent", () => {
  it("a new round has no pars, and a hole with none is left out of to par and counted as unset", () => {
    let p = play(round(["Dave"]), 0, [5, 4]);
    expect(parOf(p.golf!, 1)).toBeNull();
    expect(playerRound(p, p.records[0]!)).toMatchObject({ gross: 9, toPar: null, noPar: 2 });
    p = setHolePar(p, 1, 4);
    expect(playerRound(p, p.records[0]!)).toMatchObject({ toPar: 1, noPar: 1 });
  });
  it("a par is 3 to 6; a tap on the same par clears it back to unset", () => {
    let p = round(["Dave"]);
    expect(parOf(setHolePar(p, 1, 9).golf!, 1)).toBe(6);
    p = setHolePar(p, 2, 5);
    expect(parOf(p.golf!, 2)).toBe(5);
    expect(parOf(setHolePar(p, 2, null).golf!, 2)).toBeNull();
  });
  it("no score is ever written for a player: clearing a chip leaves the hole empty", () => {
    let p = play(round(["Dave"], { par: FOURS }), 0, [5]);
    p = setScore(p, p.records[0]!.id, 1, null);
    expect(playerRound(p, p.records[0]!).played).toBe(0);
  });
});

describe("golf: stats and the green worked out", () => {
  it("putts, fairway, penalties and sand are stored per hole, cleared to nothing", () => {
    let p = round(["Dave"]);
    const id = p.records[0]!.id;
    p = setStat(p, id, puttKey(3), "2");
    p = setStat(p, id, fairKey(3), "L");
    p = setStat(p, id, penKey(3), "1");
    p = setStat(p, id, sandKey(3), "1");
    expect(statsOf(p.records[0]!, 3)).toEqual({ putts: 2, fairway: "L", penalties: 1, sand: true });
    p = setStat(p, id, puttKey(3), "");
    expect(statsOf(p.records[0]!, 3).putts).toBeNull();
    expect(Object.keys(p.records[0]!.v)).not.toContain(puttKey(3));
  });
  it("a green is in regulation when the strokes before the putts are par less two or fewer", () => {
    expect(girOn(4, 2, 4)).toBe(true);
    expect(girOn(5, 2, 4)).toBe(false);
    expect(girOn(4, null, 4)).toBeNull();
    expect(girOn(4, 2, null)).toBeNull();
  });
});

describe("golf: handicap, net and Stableford", () => {
  it("strokes go to the hardest holes first, and a nine-hole round shares them across its nine", () => {
    const g = round(["Dave"]).golf!;
    expect([1, 2, 3, 4].map((h) => strokesOn({ ...g, si: [3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] }, 2, h))).toEqual([0, 1, 1, 0]);
    expect(strokesOn(g, 20, 1)).toBe(2);
    expect(strokesOn({ ...g, holes: 9 }, 9, 5)).toBe(1);
    expect(strokesOn(g, null, 1)).toBe(0);
  });
  it("Stableford: two for net par, none above a net bogey", () => {
    expect(stablefordOn(4, 4, 0)).toBe(2);
    expect(stablefordOn(3, 4, 0)).toBe(3);
    expect(stablefordOn(6, 4, 0)).toBe(0);
    expect(stablefordOn(5, 4, 1)).toBe(2);
  });
  it("net and points come out live, and only when a handicap was given", () => {
    let p = play(round(["Dave", "Sam"], { par: FOURS }), 0, [5, 5, 4]);
    p = setValues(p, p.records[0]!.id, { hcp: "18" });
    const a = playerRound(p, p.records[0]!);
    expect(a).toMatchObject({ gross: 14, net: 11, hcp: 18 });
    expect(a.points).toBe(7);
    p = play(p, 1, [4]);
    expect(playerRound(p, p.records[1]!).net).toBeNull();
  });
});

describe("golf: match play and the finish", () => {
  it("two players only; holes are won net of the handicap difference", () => {
    let p = { ...play(play(round(["Dave", "Sam"], { par: FOURS }), 0, [4, 5, 4]), 1, [5, 5, 5]) };
    p = { ...p, golf: { ...p.golf!, match: true } };
    expect(matchState(p)).toMatchObject({ lead: 2, thru: 3, leader: 0 });
    expect(matchState(p)!.words).toEqual({ who: "Dave", what: "2 Up Thru 3" });
    expect(matchState({ ...p, golf: { ...p.golf!, match: false } })).toBeNull();
    expect(matchState(round(["A", "B", "C"], { par: FOURS }))).toBeNull();
  });
  it("the story and the winner are told from a full card, and never guess on a half one", () => {
    const nine = (s: number[]) => s;
    let p = round(["Dave", "Sam"], { holes: 9, par: FOURS });
    p = play(p, 0, nine([4, 4, 4, 4, 4, 4, 4, 4, 4]));
    expect(winnerLine(p)).toBeNull();
    p = play(p, 1, nine([5, 5, 5, 5, 5, 5, 5, 5, 5]));
    expect(winnerLine(p)).toBe("Dave Won, 36 Gross");
    expect(roundStory(p)[0]).toMatchObject({ name: "Dave" });
    expect(roundStory(p)[0]!.facts).toContain("36 Gross");
    expect(isFinished({ ...p.golf!, finishedAt: 1 })).toBe(true);
  });
});

describe("golf: the Rounds page and the course book", () => {
  it("finishing writes one row per player and finishing again replaces them", () => {
    const p = play(round(["Dave"], { par: FOURS }), 0, [5, 4]);
    const rows = roundRows(p, "note1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.v).toMatchObject({ player: "Dave", score: "9", topar: "+1", course: "Pebble" });
    let r = withRounds(newTemplatePage("rounds"), rows, newId);
    r = withRounds(r, roundRows(play(p, 0, [5, 4, 4]), "note1"), newId);
    expect(r.records).toHaveLength(1);
    expect(r.records[0]!.v.score).toBe("13");
  });
  it("a course is remembered only when every hole has a real par, and comes back with them", () => {
    let p = round(["Dave"]);
    const rounds = newTemplatePage("rounds");
    expect(readCourseBook(rememberCourse(rounds, p.golf!))).toEqual([]);
    for (let h = 1; h <= 18; h++) p = setHolePar(p, h, h % 2 ? 4 : 3);
    expect(parsComplete(p.golf!)).toBe(true);
    const book = readCourseBook(rememberCourse(rounds, p.golf!));
    expect(book).toHaveLength(1);
    expect(findCourse(book, "  pebble ")?.par[1]).toBe(3);
    expect(parOf(applyCourse(round(["Sam"]).golf!, book[0]!), 1)).toBe(4);
  });
});

describe("golf: the stroke index says why it cannot be saved", () => {
  it("blank is fine; a gap, a repeat or a number out of range is named", () => {
    const blank = Array.from({ length: 18 }, () => "");
    expect(siProblem(blank, 18)).toBeNull();
    expect(siProblem(blank.map((_, i) => (i === 0 ? "" : String(i))), 18)).toMatch(/Every Hole/);
    expect(siProblem(blank.map((_, i) => String(i === 1 ? 1 : i + 1)), 18)).toMatch(/Repeat/);
    expect(siProblem(blank.map((_, i) => String(i + 1)), 18)).toBeNull();
    expect(siProblem(blank.map((_, i) => (i === 0 ? "19" : String(i + 1))), 18)).toMatch(/1 to 18/);
  });
});
