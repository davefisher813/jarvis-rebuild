import { describe, it, expect } from "vitest";
import { addRecord, type PageData } from "./pageModel";
import { newTemplatePage } from "./templateDefs";
import { newScoreboardPage, setPeriodScore } from "./scoreboard";
import { standingsOf } from "./templateLogic";
import { gameOf, withGame } from "./standingsFeed";

const played = (sides: string[], a: number[], b: number[], sport = "basketball"): PageData => {
  let p = newScoreboardPage(sport, sides, "2026-10-23");
  a.forEach((s, i) => { p = setPeriodScore(p, p.records[0]!.id, i + 1, s); });
  b.forEach((s, i) => { p = setPeriodScore(p, p.records[1]!.id, i + 1, s); });
  return p;
};
const league = (...names: string[]): PageData => { let p = newTemplatePage("standings"); for (const n of names) p = addRecord(p, { name: n }).page; return p; };

describe("League Standings are fed by finished Scoreboard games", () => {
  it("a scored two-sided game is a game: the totals, the names, the date", () => {
    expect(gameOf(played(["Tigers", "Bears"], [20, 18, 22, 15], [18, 20, 15, 16]))).toEqual({ date: "2026-10-23", aName: "Tigers", bName: "Bears", sa: 75, sb: 69 });
  });
  it("is not a game when it is not head to head, not scored, or the names are the same", () => {
    expect(gameOf(newScoreboardPage("basketball", ["Tigers", "Bears"], "2026-10-23"))).toBeNull();
    expect(gameOf(played(["Tigers", "Tigers"], [10], [8]))).toBeNull();
    expect(gameOf(played(["Ann", "Bo"], [], [], "darts501"))).toBeNull();
    expect(gameOf(newScoreboardPage("basketball", ["A", "B", "C"], "2026-10-23"))).toBeNull();
  });
  it("lands only when the league already has a team under both names, and makes no team of its own", () => {
    const g = gameOf(played(["tigers", " Bears "], [20], [10]))!;
    const next = withGame(league("Tigers", "Bears", "Owls"), "note1", g)!;
    expect(next.games).toHaveLength(1);
    expect(standingsOf(next).map((r) => [r.name, r.w, r.l])).toEqual([["Tigers", 1, 0], ["Owls", 0, 0], ["Bears", 0, 1]]);
    expect(withGame(league("Tigers", "Owls"), "note1", g)).toBeNull();
  });
  it("finishing the same game again replaces its row and never doubles it", () => {
    const l = league("Tigers", "Bears");
    const first = withGame(l, "note1", gameOf(played(["Tigers", "Bears"], [20], [10]))!)!;
    const again = withGame(first, "note1", gameOf(played(["Tigers", "Bears"], [20, 5], [10]))!)!;
    expect(again.games).toHaveLength(1);
    expect(again.games![0]).toMatchObject({ sa: 25, sb: 10 });
  });
});
