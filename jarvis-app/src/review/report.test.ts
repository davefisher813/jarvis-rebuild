import { describe, it, expect } from "vitest";
import { buildReport, deltaOf, movedIn, pickFacts, trainJoin, monthName, waitFact, type ReportInputs } from "./report";
import type { MonthSealData } from "./seal";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { Workout } from "../gym/types";

const emptySeal = (month: string, over: Partial<MonthSealData> = {}): MonthSealData => ({
  month, sealedAt: 1, done: 0, pushed: 0, daysIn: 0, byCategory: {}, bandStart: null,
  sessions: 0, deposits: 0, saved: 0, goalsLive: 0, goalsAchieved: 0,
  bandCount: 0, byHour: new Array(24).fill(0), doneByDay: {}, pushedByCategory: {},
  slip: null, byPick: [], overrunByCategory: {}, suggestions: {},
  strands: { created: 0, corrected: 0, deleted: 0 }, remindersTicked: 0,
  deck: { sent: 0, asWritten: 0 }, carried: [],
  ...over,
});

const CATS = [
  { id: "work", name: "Work", color: "blue" },
  { id: "home", name: "Home", color: "orange" },
  { id: "health", name: "Health", color: "green" },
];

const goal = (title: string, over: Partial<Goal["data"]> = {}): Goal => ({
  id: title, data: { title, state: "on_track", ...over } as Goal["data"],
});
const project = (title: string, over: Partial<Project["data"]> = {}): Project => ({
  id: title, data: { title, status: "active", ...over } as Project["data"],
});
const workout = (date: string): Workout => ({
  id: "w" + date + Math.random(), data: { programId: "p", dayId: "d", dayName: "Push", date, startedAt: 1, endedAt: 2, exercises: [] },
});

function inputs(over: Partial<ReportInputs> = {}): ReportInputs {
  return {
    seal: emptySeal("2026-08"),
    prev: null,
    categories: CATS,
    goals: [],
    projects: [],
    workouts: [],
    openTaskText: () => null,
    alreadyCapped: false,
    ...over,
  };
}

describe("the hero", () => {
  it("leads with named crossings when the month has them", () => {
    const r = buildReport(inputs({
      seal: emptySeal("2026-08", { saved: 1200 }),
      goals: [goal("Half Marathon", { achievedOn: "2026-08-14", state: "achieved" })],
      projects: [project("Garage", { closedOn: "2026-08-20", status: "done" })],
    }));
    expect(r.hero.big).toBe("3");
    expect(r.hero.label).toBe("Things Moved");
    expect(r.hero.wins.map((w) => w.name)).toEqual(["Half Marathon", "Garage", "Put Away"]);
    expect(r.hero.wins[2]!.value).toBe("$1,200");
  });

  it("a month with no crossings leads with what got done, which is also true", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-08", { done: 41 }) }));
    expect(r.hero.big).toBe("41");
    expect(r.hero.label).toBe("Things Done");
    expect(r.hero.wins).toEqual([]);
  });

  it("the anchor is your own last month, or absent, never anyone else", () => {
    const withPrev = buildReport(inputs({
      seal: emptySeal("2026-08", { done: 41 }),
      prev: emptySeal("2026-07", { done: 30 }),
    }));
    expect(withPrev.hero.anchor).toBe("July: 30");
    expect(buildReport(inputs({ seal: emptySeal("2026-08", { done: 41 }) })).hero.anchor).toBeNull();
  });

  it("a crossing dated outside the month does not count inside it", () => {
    expect(movedIn("2026-08", [goal("G", { achievedOn: "2026-07-31" })], [])).toEqual([]);
    expect(movedIn("2026-08", [goal("G", { achievedOn: "2026-08-01" })], [])).toHaveLength(1);
  });
});

describe("tiles and deltas", () => {
  it("zero tiles never render; down-deltas are muted facts, not red ones", () => {
    const r = buildReport(inputs({
      seal: emptySeal("2026-08", { done: 84, sessions: 14, daysIn: 26, deposits: 9 }),
      prev: emptySeal("2026-07", { done: 72, sessions: 16, daysIn: 26, deposits: 11 }),
    }));
    expect(r.tiles.map((t) => t.label)).toEqual(["Done", "Sessions", "Days In", "Deposits"]);
    expect(r.tiles[0]!.delta).toEqual({ text: "+12 vs July", up: true });
    expect(r.tiles[1]!.delta).toEqual({ text: "−2", up: false });
    expect(r.tiles[2]!.delta).toEqual({ text: "Same", up: false });
    const thin = buildReport(inputs({ seal: emptySeal("2026-08", { done: 3 }) }));
    expect(thin.tiles.map((t) => t.label)).toEqual(["Done"]);
    expect(thin.tiles[0]!.delta).toBeNull();
  });

  it("deltaOf never invents a comparison", () => {
    expect(deltaOf(5, null, "July")).toBeNull();
    expect(deltaOf(5, 5, "July")).toEqual({ text: "Same", up: false });
  });
});

describe("worth a look", () => {
  it("carried tasks resolve against the live store and drop the vanished", () => {
    const r = buildReport(inputs({
      seal: emptySeal("2026-08", { carried: [{ id: "a", n: 7 }, { id: "gone", n: 5 }] }),
      openTaskText: (id) => (id === "a" ? "Update insurance docs" : null),
    }));
    const carried = r.worth.find((w) => w.id === "carried")!;
    expect(carried.title).toBe("1 Followed You All Month");
    expect(carried.carried).toEqual([{ id: "a", text: "Update insurance docs", n: 7 }]);
  });

  it("a quiet category needs a real prior month and a real drop", () => {
    const r = buildReport(inputs({
      seal: emptySeal("2026-08", { byCategory: { home: 2, work: 40 } }),
      prev: emptySeal("2026-07", { byCategory: { home: 11, work: 38 } }),
    }));
    const quiet = r.worth.find((w) => w.id === "quiet")!;
    expect(quiet.title).toBe("Home Went Quiet");
    // Two facts, not one caps string: stalled is amber, last month is the
    // line's one grey with its count white (§AK, §AM; 2026-09-26).
    expect(quiet.sub).toEqual([
      { text: "2 This Month", tone: "warn" },
      { text: "11 in July", parts: [{ b: "11" }, " in July"] },
    ]);
    // No prior month, no quiet card: absence of evidence stays silent.
    const noPrev = buildReport(inputs({ seal: emptySeal("2026-08", { byCategory: { home: 2 } }) }));
    expect(noPrev.worth.find((w) => w.id === "quiet")).toBeUndefined();
  });

  it("cut goals are named and framed as a decision", () => {
    const r = buildReport(inputs({
      goals: [goal("Old goal", { dropped: { on: "2026-08-10" } }), goal("Kept")],
    }));
    const cut = r.worth.find((w) => w.id === "cut")!;
    expect(cut.title).toBe("1 Goal Cut");
    // The sentence is the card's field note, never a caps sub.
    expect(cut.sub).toBeNull();
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    expect(cut.foot).toBe("Cutting Is a Decision, and It Counts");
    expect(cut.receipts).toEqual(["Old Goal"]);
  });
});

describe("patterns", () => {
  it("first picks speak only past the evidence gates", () => {
    const strong = emptySeal("2026-08", {
      byPick: [
        { n: 1, picked: 9, done: 7 },
        { n: 2, picked: 8, done: 5 },
        { n: 4, picked: 5, done: 1 },
      ],
    });
    const r = buildReport(inputs({ seal: strong }));
    const p = r.patterns.find((x) => x.id === "picks")!;
    expect(p.title).toBe("First Picks Finish");
    expect(p.sub![0]!.text).toBe("Firsts 78%, Later Picks 20%");
    // Thin months stay silent.
    const thin = buildReport(inputs({ seal: emptySeal("2026-08", { byPick: [{ n: 1, picked: 3, done: 3 }] }) }));
    expect(thin.patterns.find((x) => x.id === "picks")).toBeUndefined();
  });

  it("the train join needs three days on each side", () => {
    expect(trainJoin({ "2026-08-03": 4 }, [workout("2026-08-03")], "2026-08")).toBeNull();
    const done = {
      "2026-08-03": 4, "2026-08-05": 5, "2026-08-07": 4,
      "2026-08-04": 2, "2026-08-06": 2, "2026-08-08": 2,
    };
    const j = trainJoin(done, [workout("2026-08-03"), workout("2026-08-05"), workout("2026-08-07")], "2026-08")!;
    expect(j.on).toBeCloseTo(4.33, 1);
    expect(j.off).toBeCloseTo(2, 1);
  });

  it("the slip row reuses the seal's shared leader and wears a warn chip", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-08", { slip: { category: "work", n: 11 } }) }));
    const s = r.patterns.find((x) => x.id === "slip")!;
    expect(s.title).toBe("Work Slips Most");
    expect(s.chip).toEqual({ text: "11 Pushes", tone: "warn" });
  });
});

describe("the close", () => {
  it("learned shows its retractions, which is the anti-horoscope device", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-08", { strands: { created: 4, corrected: 1, deleted: 0 } }) }));
    expect(r.learned!.title).toBe("Learned 4 Things About You");
    expect(r.learned!.sub![0]!.text).toBe("You Fixed 1, It Is Gone");
  });

  it("the closer appears once, only on evidence, and never when already capped", () => {
    const seal = emptySeal("2026-08", {
      byPick: [
        { n: 1, picked: 9, done: 7 },
        { n: 4, picked: 6, done: 1 },
      ],
    });
    expect(buildReport(inputs({ seal }))!.closer).toEqual({
      n: 3,
      question: "Cap the Day at Three?",
      sub: "Your First Three Get Done, the Later Picks Mostly Do Not",
      foot: "Starting Tomorrow, Change It Any Time",
    });
    expect(buildReport(inputs({ seal, alreadyCapped: true })).closer).toBeNull();
    expect(buildReport(inputs({ seal: emptySeal("2026-08") })).closer).toBeNull();
  });

  it("the seal line names the next month", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-12") }));
    expect(r.sealed).toEqual({ title: "December Sealed", sub: "January Compares to This" });
    expect(monthName("2026-08")).toBe("August");
  });
});

// THE LIFE CARDS (2026-09-26, the pass-off): Money, Mail, People, Health and
// Decisions from the seal's v4 numbers, each with an exit and never a rule.
describe("the life cards", () => {
  it("a seal without the v4 numbers shows no card, not a row of zeros", () => {
    expect(buildReport(inputs({ seal: emptySeal("2026-08") })).life).toEqual([]);
  });

  it("money: paid in green, still due the one grey with its count white, Open Money the exit", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-08", { bills: { paid: 6, total: 2437, open: 2 } }) }));
    const m = r.life.find((c) => c.id === "money")!;
    expect(m.title).toBe("Paid 6 Bills");
    expect(m.facts).toEqual([{ text: "$2,437", tone: "good" }, { text: "2 Still Due", parts: [{ b: "2" }, " Still Due"] }]);
    expect(m.exit).toEqual({ label: "Open Money", kind: "money" });
    expect(m.receipts[0]).toBe("6 Bills Paid in August, $2,437 in All");
    // Nothing paid and nothing due: silence.
    expect(buildReport(inputs({ seal: emptySeal("2026-08", { bills: { paid: 0, total: 0, open: 0 } }) })).life).toEqual([]);
  });

  it("mail: the wait follows the rail's ladder and spends the line's one colour", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-08", { mail: { handled: 31, waitDays: 12 }, deck: { sent: 5, asWritten: 3 } }) }));
    const m = r.life.find((c) => c.id === "mail")!;
    expect(m.title).toBe("Handled 31 Emails");
    expect(m.facts[0]).toEqual({ text: "Waiting 12 Days on a Reply", tone: "warn" });
    expect(m.facts[1]!.tone).toBeUndefined();
    expect(m.exit.kind).toBe("email");
    // A gentle wait is not said; the drafts fact is then the green.
    const calm = buildReport(inputs({ seal: emptySeal("2026-08", { mail: { handled: 4, waitDays: 3 }, deck: { sent: 2, asWritten: 2 } }) }));
    expect(calm.life.find((c) => c.id === "mail")!.facts).toEqual([{ text: "2 of 2 Drafts Sent Unedited", tone: "good" }]);
    // Firm is red.
    expect(waitFact(21)).toEqual({ text: "Waiting 21 Days on a Reply", tone: "red" });
    expect(waitFact(6)).toBeNull();
  });

  it("people: quiet ids resolve against the live list and drop the vanished; Check In opens the first", () => {
    const r = buildReport(inputs({
      seal: emptySeal("2026-08", { people: { reached: 9, quiet: ["sam", "gone", "priya"] } }),
      people: [{ id: "sam", name: "Sam Okafor" }, { id: "priya", name: "Priya" }],
    }));
    const p = r.life.find((c) => c.id === "people")!;
    expect(p.title).toBe("Reached 9 People");
    expect(p.facts).toEqual([{ text: "Gone Quiet: Sam Okafor, Priya", tone: "warn" }]);
    expect(p.exit).toEqual({ label: "Check In", kind: "person", id: "sam" });
    const none = buildReport(inputs({ seal: emptySeal("2026-08", { people: { reached: 0, quiet: ["gone"] } }), people: [] }));
    expect(none.life.find((c) => c.id === "people")).toBeUndefined();
  });

  it("health: one line, PRs green, sets the one grey, and the exit is the health area", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-08", { sessions: 12, training: { sets: 140, prs: 3 } }), healthCategoryId: "hc" }));
    const h = r.life.find((c) => c.id === "health")!;
    expect(h.title).toBe("12 Sessions");
    expect(h.facts).toEqual([{ text: "3 PRs", tone: "good" }, { text: "140 Working Sets", parts: [{ b: "140" }, " Working Sets"] }]);
    expect(h.exit).toEqual({ label: "Open Health Insights", kind: "health", id: "hc" });
  });

  it("decisions: made, revisited, worked; never a verdict", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-08", { decisions: { made: 3, revisited: 2, worked: 1 } }) }));
    const d = r.life.find((c) => c.id === "decisions")!;
    expect(d.title).toBe("Made 3 Decisions");
    expect(d.facts).toEqual([{ text: "1 Worked", tone: "good" }, { text: "2 Revisited", parts: [{ b: "2" }, " Revisited"] }]);
    expect(d.exit.kind).toBe("decisions");
  });

  it("the cards are exits only: no card proposes anything, and One Change is still the one closer", () => {
    const r = buildReport(inputs({ seal: emptySeal("2026-08", { bills: { paid: 1, total: 10, open: 0 }, mail: { handled: 1, waitDays: 0 }, people: { reached: 1, quiet: [] }, sessions: 1, training: { sets: 1, prs: 0 }, decisions: { made: 1, revisited: 0, worked: 0 } }) }));
    expect(r.life.map((c) => c.id)).toEqual(["money", "mail", "people", "health", "decisions"]);
    for (const c of r.life) expect(c.exit.label).toMatch(/^(Open |Check In)/);
    expect(r.closer).toBeNull();
  });
});
