// TEMPLATES WAVE 4 (Entertainment): the bracket's draw and advancement, the draft board's order, and poker night's settling up.
import { describe, it, expect } from "vitest";
import { newTemplatePage, TEMPLATES, TEMPLATE_KEYS } from "./templateDefs";
import { addRecord, type PageData } from "./pageModel";
import { bracketOf, roundName, setWinner, resultsOf, pruneResults, draftSlot, managersOf, onTheClock, draftRosters, pokerRows, potGap, settleUp } from "./templateLogic";

const names = (n: number) => Array.from({ length: n }, (_, i) => "e" + (i + 1));

describe("the catalog", () => {
  it("wave 4 is the six Entertainment templates", () => {
    const w4 = TEMPLATE_KEYS.filter((k) => TEMPLATES[k].wave === 4);
    expect(w4.map((k) => TEMPLATES[k].name)).toEqual(["Brackets and Pools", "Fantasy Draft Board", "Watch List", "Party Planner", "Running Order", "Poker Night"]);
    for (const k of w4) expect(TEMPLATES[k].shelf).toBe("Entertainment");
  });
});

describe("the bracket", () => {
  it("seeds 1 against the last seed, and keeps the top seeds apart until the final", () => {
    const { rounds } = bracketOf(names(8), {});
    expect(rounds.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(rounds[0]!.map((m) => [m.a, m.b])).toEqual([["e1", "e8"], ["e4", "e5"], ["e2", "e7"], ["e3", "e6"]]);
  });
  it("gives the top seeds a bye when the field is not a power of two, and the bye advances by itself", () => {
    const { rounds } = bracketOf(names(6), {});
    expect(rounds[0]!.length).toBe(4);
    const byes = rounds[0]!.filter((m) => m.bye);
    expect(byes.map((m) => m.winner).sort()).toEqual(["e1", "e2"]);
    // The next round already has both byes' winners waiting.
    expect(rounds[1]![0]!.a).toBe("e1");
  });
  it("advances the winner and finds the champion", () => {
    let page = newTemplatePage("bracket");
    const ids = ["a", "b", "c", "d"].map((n) => { const r = addRecord(page, { name: n }); page = r.page; return r.id; });
    let b = bracketOf(ids, resultsOf(page));
    expect(b.rounds[0]!.map((m) => [m.a, m.b])).toEqual([[ids[0], ids[3]], [ids[1], ids[2]]]);
    page = setWinner(page, "m0-0", ids[3]!);
    page = setWinner(page, "m0-1", ids[1]!);
    b = bracketOf(ids, resultsOf(page));
    expect(b.rounds[1]![0]).toMatchObject({ a: ids[3], b: ids[1], winner: null });
    page = setWinner(page, "m1-0", ids[1]!);
    expect(bracketOf(ids, resultsOf(page)).champion).toBe(ids[1]);
    expect(roundName(0, 2)).toBe("Semifinals");
    expect(roundName(1, 2)).toBe("Final");
    expect(roundName(0, 3)).toBe("Quarterfinals");
    expect(roundName(0, 4)).toBe("Round 1");
  });
  it("changing an earlier result drops the later ones that no longer fit; clearing one clears what followed", () => {
    let page = newTemplatePage("bracket");
    const ids = ["a", "b", "c", "d"].map((n) => { const r = addRecord(page, { name: n }); page = r.page; return r.id; });
    page = setWinner(page, "m0-0", ids[0]!);
    page = setWinner(page, "m0-1", ids[1]!);
    page = setWinner(page, "m1-0", ids[0]!);
    expect(Object.keys(resultsOf(page)).sort()).toEqual(["m0-0", "m0-1", "m1-0"]);
    page = setWinner(page, "m0-0", ids[3]!);   // the d upset: a is out, so a's final win goes with it
    expect(resultsOf(page)).toEqual({ "m0-0": ids[3], "m0-1": ids[1] });
    page = setWinner(page, "m0-1", null);
    expect(resultsOf(page)).toEqual({ "m0-0": ids[3] });
  });
  it("a result for a match that cannot be played is dropped (an entrant left, or two entrants swapped seeds)", () => {
    let page = newTemplatePage("bracket");
    const ids = ["a", "b", "c", "d"].map((n) => { const r = addRecord(page, { name: n }); page = r.page; return r.id; });
    page = setWinner(page, "m0-0", ids[0]!);
    const gone = { ...page, records: page.records.filter((r) => r.id !== ids[0]) };
    expect(resultsOf(pruneResults(gone))).toEqual({});
  });
  it("one entrant is its own champion, none has nothing", () => {
    expect(bracketOf(["x"], {}).champion).toBe("x");
    expect(bracketOf([], {})).toEqual({ rounds: [], champion: null });
    expect(bracketOf(["x", "y"], {}).rounds.length).toBe(1);
  });
});

describe("the draft board", () => {
  it("snakes: the last team picks twice running, and a straight draft does not", () => {
    const snake = [0, 1, 2, 3, 4, 5].map((i) => draftSlot(i, 3, true).team);
    expect(snake).toEqual([0, 1, 2, 2, 1, 0]);
    const straight = [0, 1, 2, 3, 4, 5].map((i) => draftSlot(i, 3, false).team);
    expect(straight).toEqual([0, 1, 2, 0, 1, 2]);
    expect(draftSlot(4, 3, true)).toEqual({ overall: 5, round: 2, pick: 2, team: 1 });
  });
  it("says who is on the clock, and rosters follow the order", () => {
    let page: PageData = { ...newTemplatePage("draft"), meta: { teams: "Sam, Dana , Lee", snake: "1" } };
    expect(managersOf(page)).toEqual(["Sam", "Dana", "Lee"]);
    expect(onTheClock(page)).toMatchObject({ manager: "Sam", round: 1, pick: 1, overall: 1 });
    for (const p of ["A", "B", "C", "D"]) page = addRecord(page, { player: p }).page;
    expect(onTheClock(page)).toMatchObject({ manager: "Dana", round: 2, pick: 2 });
    const rosters = draftRosters(page);
    expect(rosters.map((r) => [r.manager, r.picks.map((x) => x.record.v.player)])).toEqual([["Sam", ["A"]], ["Dana", ["B"]], ["Lee", ["C", "D"]]]);
  });
  it("needs two teams before it says anything", () => {
    expect(onTheClock({ ...newTemplatePage("draft"), meta: { teams: "Sam", snake: "1" } })).toBeNull();
    expect(draftRosters(newTemplatePage("draft"))).toEqual([]);
  });
});

describe("poker night", () => {
  const table = (rows: [string, string, string, string][]) => {
    let page = newTemplatePage("poker");
    for (const [name, buyin, rebuy, cashout] of rows) page = addRecord(page, { name, buyin, rebuy, cashout }).page;
    return pokerRows(page);
  };
  it("works out each player's net from buy-ins, rebuys and cash-outs", () => {
    const r = table([["Sam", "20", "20", "90"], ["Dana", "20", "", "0"], ["Lee", "20", "", "10"]]);
    expect(r.map((x) => [x.name, x.inCents, x.outCents, x.netCents])).toEqual([["Sam", 4000, 9000, 5000], ["Dana", 2000, 0, -2000], ["Lee", 2000, 1000, -1000]]);
    expect(potGap(r)).toBe(2000);
  });
  it("settles a balanced table with the fewest payments, largest to largest", () => {
    const r = table([["Sam", "20", "", "80"], ["Dana", "20", "", "0"], ["Lee", "20", "", "0"], ["Jo", "20", "", "0"]]);
    expect(potGap(r)).toBe(0);
    expect(settleUp(r)).toEqual([{ from: "Dana", to: "Sam", cents: 2000 }, { from: "Lee", to: "Sam", cents: 2000 }, { from: "Jo", to: "Sam", cents: 2000 }]);
    const two = table([["A", "50", "", "20"], ["B", "30", "", "60"], ["C", "10", "", "10"]]);
    expect(potGap(two)).toBe(0);
    expect(settleUp(two)).toEqual([{ from: "A", to: "B", cents: 3000 }]);
  });
  it("is exact to the cent and square when nobody is up", () => {
    const r = table([["A", "10.10", "", "10.10"], ["B", "9.90", "", "9.90"]]);
    expect(r.map((x) => x.netCents)).toEqual([0, 0]);
    expect(settleUp(r)).toEqual([]);
    const c = table([["A", "10.05", "", "20.10"], ["B", "10.05", "", "0"]]);
    expect(settleUp(c)).toEqual([{ from: "B", to: "A", cents: 1005 }]);
  });
});
